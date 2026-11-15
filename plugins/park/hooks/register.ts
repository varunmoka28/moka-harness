import type { EngineInterface, Register } from 'claude-code'
import { FACTS_HEADING, editedFiles, factsBlock, lastPrompts, parkPrompt, seedLine } from './note'

type Agent = {
  pane_id: string
  tab_id: string
  agent: string
  agent_status: string
  name?: string
  terminal_title_stripped?: string
}

// saving: the save prompt is out. busy: the tab was mid-task, so nothing was sent.
type Outcome = 'saving' | 'saved' | 'blocked' | 'busy' | 'failed'
type Tab = { agent: Agent; outcome: Outcome }

// process.run allows ten minutes at most; herdr gives up half a minute before that.
const SAVE_WAIT_MS = 540_000
// A note older than this is not offered at session start.
const FRESH_DAYS = 3

// Where the next-session notes go, relative to the project folder.
const NOTE_DIR = '.park'

// Where a "Clear and continue" answer waits for the new chat, and how long it stays valid.
const SEED_KEY = 'park.seed'
const SEED_FRESH_MS = 120_000
const SEED_TRIES = 6

const SAVE =
  'Save your work now. Finish or write down anything unsaved: what was done, what was not checked, dead ends, and anything a later session needs. Ask nothing, do not commit or push, then stop.'

// The tabs of the last /park, by pane. A reload empties it; /park close then asks for a new /park.
let tabs = new Map<string, Tab>()
// The tab this session runs in; /park close never closes it, even when another agent shares it.
let ownTab: string | undefined
let isParking = false
let clearStatus: { cancel: () => void } | undefined
// Set when the park request goes out: the notes that already existed, so the new one can be told apart.
let awaiting: Map<string, number> | undefined

const label = (a: Agent) => (a.name ?? a.terminal_title_stripped ?? a.pane_id).slice(0, 28)

const lines = (list: Iterable<Tab>) =>
  [...list].map(t => `${t.outcome.padEnd(7)} ${t.agent.agent.padEnd(7)} ${label(t.agent)}`).join('\n')

// Without herdr (no session, or no pane id to tell this tab apart) there are no other tabs to act on.
async function herdr($: EngineInterface, args: readonly string[], timeoutMs?: number) {
  const session = await $.env.get('HERDR_SESSION')
  if (session === undefined || (await $.env.get('HERDR_PANE_ID')) === undefined) return undefined

  return $.process.run(['herdr', '--session', session, ...args], timeoutMs === undefined ? undefined : { timeoutMs })
}

// undefined means the list could not be read (no herdr, or herdr failed); [] means there are no other tabs.
async function others($: EngineInterface): Promise<Agent[] | undefined> {
  const ran = await herdr($, ['agent', 'list'])
  if (ran === undefined || ran.exitCode !== 0) return undefined
  const self = await $.env.get('HERDR_PANE_ID')
  const agents: Agent[] = JSON.parse(ran.stdout).result.agents
  ownTab = agents.find(a => a.pane_id === self)?.tab_id ?? ownTab

  return agents.filter(a => a.pane_id !== self)
}

// A command hook may not submit a prompt itself (it holds the turn the prompt would wait on),
// so the prompt goes out from a timer just after the hook has answered.
function later($: EngineInterface, text: string) {
  $.clock.after(250, () => void $.prompt.submit({ text, asUser: true }))
}

// The park request goes out once the tabs have settled; remember which notes exist before the model writes one.
async function sendPark($: EngineInterface, tabList: string) {
  try {
    const cwd = await $.session.cwd()
    awaiting = new Map((await $.fs.list(`${cwd}/${NOTE_DIR}`)).map(f => [f.name, f.mtimeMs]))
  } catch {
    awaiting = new Map()
  }
  later($, parkPrompt(NOTE_DIR, tabList))
}

// The note the park turn wrote: new, or changed since the request went out.
async function writtenNote($: EngineInterface, before: Map<string, number>): Promise<string | undefined> {
  const cwd = await $.session.cwd()
  const fresh = (await $.fs.list(`${cwd}/${NOTE_DIR}`))
    .filter(f => /^park-.*\.md$/.test(f.name) && before.get(f.name) !== f.mtimeMs)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)

  return fresh[0]?.name
}

// Adds what the code can read for itself. Appends only; a part that fails is left out.
async function addFacts($: EngineInterface, path: string) {
  const parts: Parameters<typeof factsBlock>[0] = {}
  let messages: Awaited<ReturnType<EngineInterface['session']['messages']>> = []
  try {
    messages = await $.session.messages()
    parts.files = editedFiles(messages)
    parts.prompts = lastPrompts(messages, 5)
  } catch {}
  try {
    const git = await $.process.run(['git', 'status', '--short'])
    if (git.exitCode === 0) parts.git = git.stdout
  } catch {}
  // No append call exists in the mod API, so the note is read whole and written back with the block on the end.
  const text = await $.fs.read(path)
  if (typeof text !== 'string' || text.includes(FACTS_HEADING)) return
  await $.fs.write(path, text.replace(/\s*$/, '\n') + factsBlock(parts))
}

// After the park turn: add the facts, then ask once whether to continue in a fresh chat.
async function finishPark($: EngineInterface, before: Map<string, number>) {
  const note = await writtenNote($, before)
  if (note === undefined) return $.ui.toast(`No new note appeared in ${NOTE_DIR}. Staying here.`, { timeoutMs: 15_000 })
  const cwd = await $.session.cwd()
  try {
    await addFacts($, `${cwd}/${NOTE_DIR}/${note}`)
  } catch {
    return $.ui.toast(`Could not add the facts to ${NOTE_DIR}/${note}. Staying here.`, { timeoutMs: 15_000 })
  }

  let answer = 'Stay here'
  try {
    answer = await $.ui.ask('Note saved. Continue in a fresh chat?', ['Clear and continue', 'Stay here'])
  } catch {}
  if (answer !== 'Clear and continue') return

  try {
    await $.store.set(SEED_KEY, { note, at: await $.clock.now() })
    await $.command.run({ command: 'clear' })
  } catch {
    await $.store.delete(SEED_KEY).catch(() => {})
    $.ui.toast('Could not clear the chat. Staying here.', { timeoutMs: 15_000 })
  }
}

// The new chat's first prompt. The path is taken out of the store before it is used, so it fires once;
// a chat that is not ready yet gets another go a moment later.
function seed($: EngineInterface, triesLeft = SEED_TRIES) {
  $.clock.after(500, () => {
    void (async () => {
      const held = (await $.store.get(SEED_KEY)) as { note?: string; at?: number } | undefined
      if (held?.note === undefined) return
      if ((await $.clock.now()) - (held.at ?? 0) > SEED_FRESH_MS) return void (await $.store.delete(SEED_KEY))
      try {
        await $.prompt.submit({ text: seedLine(NOTE_DIR, held.note), asUser: true })
        await $.store.delete(SEED_KEY)
      } catch {
        if (triesLeft > 1) seed($, triesLeft - 1)
        else await $.store.delete(SEED_KEY).catch(() => {})
      }
    })().catch(() => {})
  })
}

function show($: EngineInterface) {
  $.ui.status(tabs.size === 0 ? undefined : `park: ${[...tabs.values()].map(t => `${label(t.agent)} ${t.outcome}`).join(', ')}`)
}

// Known limit: "saved" means the tab took the save prompt and went quiet. The pane is not read to
// confirm the save itself; add a `herdr agent read` check if a false "saved" ever shows up.
async function save($: EngineInterface, tab: Tab) {
  try {
    const ran = await herdr(
      $,
      ['agent', 'prompt', tab.agent.pane_id, SAVE, '--wait', '--timeout', String(SAVE_WAIT_MS)],
      SAVE_WAIT_MS + 30_000,
    )
    const status = ran?.exitCode === 0 ? /"agent_status":"(\w+)"/.exec(ran.stdout)?.[1] : undefined
    tab.outcome = status === 'idle' || status === 'done' ? 'saved' : status === 'blocked' ? 'blocked' : 'failed'
  } catch {
    tab.outcome = 'failed'
  }
  show($)
}

async function close($: EngineInterface) {
  const all = [...tabs.values()]
  if (all.length === 0) return { text: 'Nothing parked. Run /park first.' }
  // A saved tab that was given new work since is no longer safe to close.
  const current = await others($)
  if (current === undefined) return { text: 'Not closing. Could not read the tab list from herdr.' }
  // Any agent working in a tab keeps that tab open, including one that started after /park.
  const workingTabs = new Set(current.filter(a => a.agent_status === 'working').map(a => a.tab_id))
  const open = all.filter(t => t.outcome !== 'saved' || workingTabs.has(t.agent.tab_id))
  if (open.length > 0) return { text: `Not closing. These tabs are not saved, or are working again:\n${lines(open)}` }

  const ids = new Set(all.map(t => t.agent.tab_id))
  ids.delete(ownTab ?? '')
  const failed = new Set<string>()
  for (const id of ids) {
    const ran = await herdr($, ['tab', 'close', id])
    if (ran?.exitCode !== 0) failed.add(id)
  }
  // Tabs that did not close stay listed, so /park close can be run again.
  tabs = new Map([...tabs].filter(([, t]) => failed.has(t.agent.tab_id)))
  show($)
  const closed = ids.size - failed.size
  const text = `Closed ${closed} saved tab${closed === 1 ? '' : 's'}.`

  return { text: failed.size === 0 ? text : `${text} Could not close ${failed.size}; run /park close again.` }
}

// The newest note in this project's .park folder, no older than `days`.
async function newestNote($: EngineInterface, days: number): Promise<string | undefined> {
  const cwd = await $.session.cwd()
  try {
    const ran = await $.process.run([
      'find', `${cwd}/${NOTE_DIR}`, '-maxdepth', '1', '-name', 'park-*.md', '-mtime', `-${days}`, '-exec', 'ls', '-t', '{}', '+',
    ])

    return ran.exitCode === 0 ? ran.stdout.split('\n')[0]?.split('/').pop() || undefined : undefined
  } catch {
    // no `find` on this machine (Windows): there is simply no note to offer
    return undefined
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    if (e.isInteractive) {
      // In case the engine starts a session after /clear instead of only ending one.
      seed($)
      await $.command.register({
        name: 'park',
        description: 'Save this tab and write a note for the next session. In herdr, also saves the other agent tabs; /park close closes them',
        immediate: true,
      })
      await $.command.register({
        name: 'unpark',
        description: `Pick up the newest next-session note from ${NOTE_DIR}`,
        immediate: true,
      })
      const note = await newestNote($, FRESH_DAYS)
      if (note !== undefined) {
        $.ui.toast(`Parked note: ${note}. Type /unpark to pick it up.`, { timeoutMs: 15_000 })
      }
    }

    return next(e)
  })

  // A /clear fires no session.start, only this; the chat it opens gets the note as its first prompt.
  on('session.end', ($, e, next) => {
    if (e.reason === 'clear') seed($)

    return next(e)
  })

  // The park turn is over: add the facts and offer the fresh chat. An interrupted turn offers nothing.
  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined && awaiting !== undefined) {
      const before = awaiting
      awaiting = undefined
      if (!e.isAborted) {
        void finishPark($, before).catch(() => $.ui.toast('Park could not finish. Staying here.', { timeoutMs: 15_000 }))
      }
    }

    return next(e)
  })

  on('command.run', { command: 'park' }, async ($, e) => {
    if (e.args.trim() === 'close') return close($)
    if (isParking) return { text: `Already parking:\n${lines(tabs.values())}` }

    clearStatus?.cancel()
    isParking = true
    let agents: Agent[]
    try {
      agents = (await others($)) ?? []
    } catch (err) {
      isParking = false
      throw err
    }
    const first = (a: Agent): Outcome =>
      a.agent_status === 'working' ? 'busy' : a.agent_status === 'blocked' ? 'blocked' : 'saving'
    tabs = new Map(agents.map(a => [a.pane_id, { agent: a, outcome: first(a) }]))
    show($)

    const sent = [...tabs.values()].filter(t => t.outcome === 'saving')
    void Promise.all(sent.map(t => save($, t))).then(() => {
      isParking = false
      void sendPark($, lines(tabs.values()))
      // the line has done its job once the note is going out; /park close still works from `tabs`
      clearStatus = $.clock.after(60_000, () => $.ui.status(undefined))
    })

    return {
      text:
        agents.length === 0
          ? 'No other agent tabs. Saving this tab and writing the next-session note.'
          : `Parking ${agents.length} tab${agents.length === 1 ? '' : 's'}. This tab saves once they settle.\n${lines(tabs.values())}`,
    }
  })

  on('command.run', { command: 'unpark' }, async $ => {
    const note = await newestNote($, 3650)
    if (note === undefined) return { text: `No park note in ${NOTE_DIR}.` }
    later($, seedLine(NOTE_DIR, note))

    return { text: `Picking up ${note}.` }
  })
}
