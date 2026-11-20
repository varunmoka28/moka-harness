import type { EngineInterface, Register } from 'claude-code'

// Enough of the prompt to tell the tabs apart; herdr shows the label in a narrow strip.
const MAX_CHARS = 40
// How many of the last prompts the relabel call reads to tell what the tab is on now.
const RECENT = 4
// Haiku is asked again once this many prompts have come in since it was last asked.
const EVERY = 3
// Words a request opens with that say nothing about the task.
const FILLER = /^(please|hey|can you|could you|would you|i want to|i need to|let'?s)\b[\s,]*/i

// One rename per load from the first prompt. A tab somebody already labelled is left alone either way.
let named = false
// The last real prompts, oldest first.
let recent: string[] = []
// The label this module last gave the tab, '' while it has given none. Only that label is ours to change.
let mine = ''
// The folder the session started in. herdr names a new workspace after its folder, so this is the workspace's default name.
let home = ''
// Prompts counted this load, and the count when Haiku was last asked (-1: not yet).
let prompts = 0
let relabelledAt = -1

const SYSTEM =
  'You label a terminal tab. Reply with the label alone: at most 5 words, lower case, no quotes, ' +
  'naming the task being worked on now. If the current label still fits, reply with it unchanged.'

const flat = (text: string, max: number) => text.replace(/\s+/g, ' ').trim().slice(0, max)
const task = (text: string) => flat(text, MAX_CHARS)

// The first label, made without a model: the first five words after any opening filler, cut at a word break.
function tidy(text: string) {
  let t = flat(text, 1_000)
  while (FILLER.test(t)) t = t.replace(FILLER, '')
  t = t.split(' ').slice(0, 5).join(' ').replace(/[\s.,;:!?]+$/, '')
  if (t.length <= MAX_CHARS) return t
  const cut = t.slice(0, MAX_CHARS + 1).lastIndexOf(' ')

  return cut > 0 ? t.slice(0, cut) : t.slice(0, MAX_CHARS)
}

// What a prompt says about the task: a slash command's arguments, '' for a bare command.
const said = (text: string) => {
  const t = text.trim()

  return t.startsWith('/') ? t.replace(/^\S+\s*/, '') : t
}

type Space = { label: string; rename: (title: string) => Promise<boolean> }
type Tab = { label: string; isDefault: boolean; rename: (title: string) => Promise<boolean>; space?: Space }

// The workspace the tab sits in. When herdr does not answer for it there is none, and the tab is still named.
async function around($: EngineInterface, session: string, id: unknown): Promise<Space | undefined> {
  if (typeof id !== 'string') return undefined

  try {
    const got = await $.process.run(['herdr', '--session', session, 'workspace', 'get', id])
    if (got.exitCode !== 0) return undefined
    const { label } = JSON.parse(got.stdout).result.workspace
    if (typeof label !== 'string') return undefined

    return {
      label,
      rename: async title =>
        (await $.process.run(['herdr', '--session', session, 'workspace', 'rename', id, title])).exitCode === 0,
    }
  } catch {
    return undefined
  }
}

// One JSON-RPC call to the Herdr desktop app's core (herdr-core), which keeps the app's spaces and tabs in the doc "herdr-app".
async function core($: EngineInterface, method: string, params: object) {
  const request = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  const got = await $.process.run(['herdr-core', 'connect'], { stdin: request + '\n', timeoutMs: 10_000 })
  const reply = JSON.parse(got.stdout.split('\n')[0])
  if (got.exitCode !== 0 || reply.error !== undefined) throw new Error(`herdr-core ${method} failed`)

  return reply.result
}

type AppSpace = { id: string; name: string; tabs: { name: string; root: unknown }[] }

const holds = (tab: { root: unknown }, terminal: string) => JSON.stringify(tab.root).includes(`"terminal":"${terminal}"`)

// Writes one name into the app doc. doc.set only takes the version it was read at, so a doc that moved meanwhile is read again.
async function setName($: EngineInterface, spaceId: string, terminal: string, of: 'space' | 'tab', title: string) {
  for (let tries = 0; tries < 3; tries++) {
    const doc = await core($, 'doc.get', { name: 'herdr-app' })
    const space = (doc.value.spaces as AppSpace[]).find(s => s.id === spaceId)
    const target = of === 'space' ? space : space?.tabs.find(t => holds(t, terminal))
    if (target === undefined) return false
    target.name = title
    if (await core($, 'doc.set', { name: 'herdr-app', value: doc.value, version: doc.version }).then(() => true, () => false)) return true
  }

  return false
}

// The tab this session runs in inside the Herdr desktop app. An unnamed space shows its folder's name, so it reads as `home` here.
async function inApp($: EngineInterface): Promise<Tab | undefined> {
  const terminal = await $.env.get('HC_TERMINAL_ID')
  if (terminal === undefined) return undefined

  try {
    const spaceId = (await core($, 'terminal.get', { terminal })).labels['herdr.space']
    const space = ((await core($, 'doc.get', { name: 'herdr-app' })).value.spaces as AppSpace[]).find(s => s.id === spaceId)
    const tab = space?.tabs.find(t => holds(t, terminal))
    if (space === undefined || tab === undefined) return undefined

    return {
      label: tab.name,
      isDefault: tab.name === '',
      rename: title => setName($, space.id, terminal, 'tab', title),
      space: { label: space.name || home, rename: title => setName($, space.id, terminal, 'space', title) },
    }
  } catch {
    return undefined
  }
}

// The herdr tab this session runs in: herdr in a terminal first, then the Herdr desktop app.
// Outside both, or when herdr does not answer, there is none and the mod does nothing.
async function here($: EngineInterface): Promise<Tab | undefined> {
  const session = await $.env.get('HERDR_SESSION')
  const tab = await $.env.get('HERDR_TAB_ID')
  if (session === undefined || tab === undefined) return inApp($)

  try {
    const got = await $.process.run(['herdr', '--session', session, 'tab', 'get', tab])
    if (got.exitCode !== 0) return undefined
    const { label, workspace_id } = JSON.parse(got.stdout).result.tab
    if (typeof label !== 'string') return undefined

    return {
      label,
      space: await around($, session, workspace_id),
      // herdr's default label is a number (a creation counter, which need not be the tab's position)
      // until the shell in the tab starts, and the shell's name from then on
      isDefault: /^(\d+|zsh|bash|fish|sh)$/.test(label),
      rename: async title =>
        (await $.process.run(['herdr', '--session', session, 'tab', 'rename', tab, title])).exitCode === 0,
    }
  } catch {
    return undefined
  }
}

async function rename(at: Tab, title: string) {
  if (!(await at.rename(title))) return false
  // The workspace follows the tab while its name is herdr's default or the one this module gave it. Any other name is somebody's.
  const space = at.space
  if (space !== undefined && (space.label === home || (mine !== '' && space.label === mine))) await space.rename(title).catch(() => {})
  mine = title

  return true
}

async function name($: EngineInterface, text: string) {
  const at = await here($)
  if (at === undefined || !at.isDefault) return

  const title = tidy(text)
  if (title === '') return
  if (await rename(at, title)) $.ui.toast(`Tab named "${title}"`, { timeoutMs: 5_000 })
}

// Asks the small model what the tab is on now and renames it when that moved.
async function relabel($: EngineInterface, answer: string) {
  // Counted before the early returns: a tab that is not ours is not looked up again until new prompts come in.
  relabelledAt = prompts
  const at = await here($)
  // Ours to change: herdr's default, or the label this module gave it. Any other label is somebody's.
  if (at === undefined || !(at.isDefault || at.label === mine)) return

  const now = at.isDefault ? '' : at.label
  const reply = await $.model.complete({
    model: 'haiku',
    system: SYSTEM,
    prompt:
      `Current label: ${now}\n\nRecent requests, oldest first:\n` +
      recent.map(r => `- ${r}`).join('\n') +
      `\n\nThe last reply began:\n${flat(answer, 400)}`,
    maxTokens: 30,
    timeoutMs: 10_000,
  })
  if (!reply.isAnswered) return

  const next = task(reply.text.replace(/["`]/g, ''))
  if (next !== '' && next !== now) await rename(at, next)
}

async function prompt($: EngineInterface, raw: string) {
  const text = said(raw)
  // A bare slash command is not a task.
  if (text === '') return
  recent = [...recent, flat(text, 200)].slice(-RECENT)
  prompts++
  // The first real prompt is the task.
  // Awaited: a call left running after the hook answers is not the module's any more.
  if (!named) {
    named = true
    await name($, text)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tab-namer',
      description: 'Turn the tab relabelling on or off',
      argumentHint: '[on | off]',
    })
    named = false
    mine = ''
    home = e.cwd.split('/').filter(Boolean).pop() ?? ''
    recent = []
    prompts = 0
    relabelledAt = -1

    return next(e)
  })

  on('command.run', { command: 'tab-namer' }, async ($, e) => {
    const verb = e.args.trim().toLowerCase()
    if (verb === 'on' || verb === 'off') await $.store.set('relabel', verb === 'on')
    const enabled = Boolean(await $.store.get('relabel'))

    return { text: `Tab relabelling is ${enabled ? 'on' : 'off'}. /tab-namer ${enabled ? 'off' : 'on'} to switch it. The first label is always free.` }
  })

  on('prompt.submit', async ($, e, next) => {
    // A thrown error must never hold up the prompt.
    await prompt($, e.text).catch(() => {})

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // The main loop's finished turns only: a subagent's turn is not what the tab is on.
    // Haiku after the first turn, then only once EVERY prompts have come in since.
    const due = relabelledAt < 0 || prompts - relabelledAt >= EVERY
    if (e.agentId === undefined && !e.isAborted && prompts > 0 && due) {
      // Off until the user turns it on: each relabel is a model call.
      if (await $.store.get('relabel').catch(() => false)) await relabel($, e.answer).catch(() => {})
    }

    return next(e)
  })
}
