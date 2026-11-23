import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, ModelUsage, Register, SessionMessage } from 'claude-code'

import type { SideThread, SideTurn } from '../types'

const turns = atom({ plugin: 'side-chat', key: 'turns' } as const, [] as SideTurn[])
const pending = atom({ plugin: 'side-chat', key: 'pending' } as const, '')
const model = atom({ plugin: 'side-chat', key: 'model' } as const, '')
// Input is one line, so a long or multi-line draft is echoed above it in full.
const draft = atom({ plugin: 'side-chat', key: 'draft' } as const, '')
const thread = atom({ plugin: 'side-chat', key: 'thread' } as const, { id: '', started: '' })
const notice = atom({ plugin: 'side-chat', key: 'notice' } as const, '')
const picking = atom({ plugin: 'side-chat', key: 'picking' } as const, false)
const opened = atom({ plugin: 'side-chat', key: 'opened' } as const, [] as number[])
// The card Copy and Fork act on; -1 is the newest, which it keeps following as answers arrive.
const picked = atom({ plugin: 'side-chat', key: 'picked' } as const, -1)
const MAX_THREADS = 30
const HISTORY_SENT = 20
const HISTORY_CHARS = 8000
const FOLD_LINES = 12
// Short labels so the row fits a narrow pane; each still sends its full question.
// Card actions as coloured pills, so each reads at a glance. Fork is magenta because it starts an agent with full tools.
const ACTIONS = [
  { name: 'copy', label: 'Copy', bg: 'cyan', fg: 'black', key: 'c' },
  { name: 'draft', label: 'Draft', bg: 'blue', fg: 'white', key: undefined },
  { name: 'send', label: 'Send', bg: 'green', fg: 'black', key: undefined },
  { name: 'fork', label: 'Fork', bg: 'magenta', fg: 'white', key: 'f' },
] as const

const CHIPS = [
  { label: 'WRD?', q: 'What are you doing?' },
  { label: 'Explain', q: 'Explain that in plain words' },
  { label: 'Next?', q: "What's next?" },
]
// Bumped by Stop: an answer from an older round is dropped. The engine has no way to cancel a fork or agent.
let round = 0
// Stop aborts the haiku fallback's request; the fork cannot be cancelled.
let fallback = new AbortController()
const PANE = 'side-chat'
const MODELS = ['default', 'haiku', 'sonnet', 'opus']
// The haiku fallback reads the main transcript's text, its tail cut to this.
const TRANSCRIPT_CHARS = 60000
// Index of the main loop's latest request in the running turn (main only, counted from 0; a subagent's steps must not touch it), undefined when idle.
let mainStep: number | undefined

// Set from the instructions setting when the mod loads.
let custom = ''
let takeKeyboard = true
let defaultModel = 'haiku'

// Side turns are replayed inside each prompt because fork takes one message.
const buildPrompt = (history: SideTurn[], q: string, agents: string[], source: 'main' | 'agent' | 'none' = 'main') =>
  [
    ...(custom ? [`The person's own instructions for this side chat: ${custom}`] : []),
    `The person asked the question at the end of this message in a side panel. Answer that question directly, in at most 6 short lines of plain markdown, using ${{ main: 'the conversation above', agent: 'the agent transcript above', none: 'the side thread only' }[source]}. Never describe this message or these instructions. Read typos charitably. Use no tools.`,
    'If the question asks for a prompt (to give, write or send), the answer is only that prompt text, with no intro, explanation or closing line, and the 6-line limit does not apply.',
    ...(source === 'main' ? ["The main conversation's latest request may look unanswered: the main thread is still on it. Do not answer it or continue that work; answer only the side question."] : []),
    ...(agents.length ? ['Agents running in this session right now:', ...agents] : []),
    ...history.flatMap(t => [`Earlier question: ${t.q}`, `Earlier answer: ${t.a}`]),
    `Question: ${q}`,
  ].join('\n')

// The newest of the last turns that fit HISTORY_CHARS of question and answer; a lone newest turn over it keeps its answer's start.
const fitHistory = (list: SideTurn[]) => {
  const kept: SideTurn[] = []
  let used = 0
  for (const t of [...list].reverse()) {
    const size = t.q.length + t.a.length
    if (used + size <= HISTORY_CHARS) {
      kept.unshift(t)
      used += size
      continue
    }
    if (!kept.length) kept.push({ ...t, a: t.a.slice(0, Math.max(0, HISTORY_CHARS - t.q.length)) })
    break
  }
  return kept
}

// A started agent's answer arrives later as its turn.complete; `early` holds one that beat the wait.
const waiting = new Map<string, (answer: string) => void>()
const early = new Map<string, string>()
// Ids of agents this mod started: every other subagent's turn is none of its business.
const started = new Set<string>()
// Name, id and type of subagents seen at turn.start or turn.complete, oldest first, so `^name` still finds one that has finished.
// In memory like `started` and `early`: agent ids mean nothing after the session, so $.store would only keep stale names.
// The engine drops a finished agent from agent.list() within seconds, but session.messages({ agentId }) still reads its
// transcript (checked live 2026-11-21), so this keeps the name-to-id link. Capped so it cannot grow without end.
const known = new Map<string, Pick<AgentInfo, 'id' | 'name' | 'type'>>()
const KNOWN_MAX = 50
async function remember($: EngineInterface, agentId: string) {
  const a = (await $.agent.list()).find(x => x.id === agentId)
  if (!a) return
  known.delete(a.id)
  if (known.size >= KNOWN_MAX) known.delete(known.keys().next().value as string)
  known.set(a.id, { id: a.id, name: a.name, type: a.type })
}
// Side-chat agents answer questions; they never change the project. Agent (its helpers are not ours) and REPL (a shell) would get round that.
const WRITERS = ['Edit', 'Write', 'NotebookEdit', 'MultiEdit', 'Bash', 'Agent', 'REPL']
// The fork button starts the one agent of ours that may write, with full tools (Varun's choice). The guard finds it by this
// description, which is on the agent list from the moment it runs, where an id would only be known after spawn returns.
// f agents have full tools and run in the same folder as the main session, so the two can edit the same file at once and neither sees the other's edits.
// That was chosen on purpose; do not narrow it, or add a Bash/Edit block for the fork, without asking.
const FORK_DESC = 'side chat fork'
// Asks still waiting for spawn to return an id; an agent that finishes in that gap has no id on file yet.
let starting = 0
const answerOf = (id: string) =>
  early.has(id) ? Promise.resolve(early.get(id) as string) : new Promise<string>(done => waiting.set(id, done))

// An answer that writes tool calls out as text ran nothing; the note keeps it from being read as work done.
const TOOL_TEXT = /<\/?(?:antml:)?(?:function_calls|invoke|tool_use|tool_call)\b/i
const NO_EXEC = '\n\n_Tool calls written above are text only. Nothing was executed._'

const kilo = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
// One dim line under an answer: time, and how much of the prompt the cache served.
const costOf = (u: ModelUsage, since: number) =>
  `${((Date.now() - since) / 1000).toFixed(1)}s · read ${kilo(u.cache_read_input_tokens)} · new ${kilo(u.input_tokens + u.cache_creation_input_tokens)} · out ${kilo(u.output_tokens)}`

async function finish($: EngineInterface, q: string, answer: string, via?: SideTurn['via'], cost?: string) {
  const a = TOOL_TEXT.test(answer) ? answer + NO_EXEC : answer
  await update($, turns, list => [...list, { q, a, ...(via ? { via } : {}), ...(cost ? { cost } : {}) }].slice(-50))
  await update($, picked, () => -1)
  await update($, pending, () => '')
  await save($)
  await $.ui.scroll({ in: PANE, to: 'end' }).catch(() => ({}))
}

async function askAgent($: EngineInterface, name: string, q: string) {
  const label = `@${name} ${q}`
  const mine = ++round
  await update($, pending, () => label)
  const chosen = (await read($, model)) || defaultModel
  starting++
  let spawned
  try {
    spawned = await $.agent.spawn({
      subagentType: name,
      ...(chosen !== 'default' ? { model: chosen } : {}),
      description: 'side chat question',
      prompt: `A side-chat question, answer in at most 8 short lines of plain text. The main chat may be working in this folder, so do not change any files. Question: ${q}`,
    })
  } finally {
    starting--
  }
  if (mine !== round) return
  if (spawned.deny !== undefined || !spawned.agentId) {
    return finish($, label, `Could not start ${name}: ${spawned.deny ?? 'no agent id'}.`)
  }
  started.add(spawned.agentId)
  const answer = await answerOf(spawned.agentId)
  early.delete(spawned.agentId)
  started.delete(spawned.agentId)
  if (starting === 0) early.clear()
  if (mine !== round) return
  return finish($, label, answer || `${name} gave no answer.`, 'agent')
}

// The engine cannot tell which agent transcript is open on screen, so the person names one:
// the agent's name (what SendMessage uses), else its type (Explore), else its id; the newest listed wins.
// A transcript is read through $.model.complete, which has no tools, so this stays read-only.
const rowText = (m: SessionMessage) =>
  [
    m.text && `${m.role}: ${m.text}`,
    ...m.toolUses.map(u => `tool ${u.tool} ${JSON.stringify(u.input).slice(0, 200)}: ${(u.text ?? '').slice(0, 500)}`),
  ]
    .filter(Boolean)
    .join('\n')

async function askTranscript($: EngineInterface, name: string, q: string, history: SideTurn[]) {
  const label = `^${name} ${q}`
  const mine = ++round
  await update($, pending, () => label)
  const since = Date.now()
  const live = [...(await $.agent.list())].reverse()
  // Finished agents follow the live ones, so a live agent of the same name or type still wins.
  const list = [...live, ...[...known.values()].reverse().filter(k => !live.some(a => a.id === k.id))]
  const is = (x?: string) => x?.toLowerCase() === name.toLowerCase()
  const agent = list.find(a => is(a.name)) ?? list.find(a => is(a.type)) ?? list.find(a => a.id === name)
  if (!agent) return finish($, label, `No agent called ${name}. Agents now: ${list.map(a => a.name ?? a.type).join(', ') || 'none'}.`)
  const rows = await $.session.messages({ agentId: agent.id })
  if (mine !== round) return
  if (!Array.isArray(rows)) return finish($, label, `Cannot read ${name}: ${rows.deny}`)
  const text = rows.map(rowText).filter(Boolean).join('\n').slice(-TRANSCRIPT_CHARS)
  const prompt = `The transcript of the agent "${name}" so far, as text only:\n${text}\n\n${buildPrompt(history, q, [], 'agent')}`
  const chosen = (await read($, model)) || defaultModel
  fallback = new AbortController()
  const r = await $.model.complete({ model: chosen === 'default' ? 'haiku' : chosen, prompt, maxTokens: 2048 }, { signal: fallback.signal })
  if (mine !== round) return
  if (!r.isAnswered) return finish($, label, `No reply (${r.reason}).`)
  return finish($, label, r.text, 'transcript', `${agent.name ?? agent.type} transcript · ${costOf(r.usage, since)}`)
}

async function ask($: EngineInterface, q: string) {
  const word = q.trim().replace(/^\//, '')
  const done = await control($, word)
  if (done) return
  if (!q.trim() || (await read($, pending))) return
  const agent = /^@([\w-]+)\s+(.+)$/s.exec(q.trim())
  if (agent) return askAgent($, agent[1], agent[2])
  const history = fitHistory((await read($, turns)).slice(-HISTORY_SENT))
  const peek = /^\^(\S+)\s+(.+)$/s.exec(q.trim())
  if (peek) return askTranscript($, peek[1], peek[2], history)
  const running = (await $.agent.list())
    .filter(x => x.status === 'running' || x.status === 'pending' || x.status === 'waiting')
    .map(x => `- ${x.type} (${x.status}): ${x.description}`)
  const mine = ++round
  await update($, pending, () => q)
  const since = Date.now()
  // Taken before the fork starts: the stamp says what it saw then, not when its answer lands.
  const step = mainStep
  const stamp = step === undefined ? '' : `as of step ${step + 1} · `
  const r = await $.model.fork({ prompt: buildPrompt(history, q, running) })
  if (mine !== round) return
  if (r.isAnswered) return finish($, q, r.text, 'fork', stamp + costOf(r.usage, since))
  // The fork failed (fresh or cleared session, API error): haiku answers from the transcript's text instead.
  // Only tool names go in, never inputs or results: a tool result can be huge or private and the fallback must stay small.
  const main = (await $.session.messages())
    // Local slash commands (/clear) leave echo rows, not conversation.
    .filter(m => (m.text || m.toolUses.length) && !/^\s*<(command-name>|local-command-)/.test(m.text))
    .map(m => {
      const tools = [...new Set(m.toolUses.map(u => u.tool))].join(', ')
      return `${m.role}: ${[m.text, tools && `[tools: ${tools}]`].filter(Boolean).join(' ')}`
    })
    .join('\n')
    .slice(-TRANSCRIPT_CHARS)
  const prompt = (main ? `The main conversation so far, as text. A bracket after a message lists the tools it called; their results are not included:\n${main}\n\n` : '') + buildPrompt(history, q, running, main ? 'main' : 'none')
  if (mine !== round) return
  fallback = new AbortController()
  const h = await $.model.complete({ model: 'haiku', prompt, maxTokens: 2048 }, { signal: fallback.signal })
  if (mine !== round) return
  if (!h.isAnswered) return finish($, q, `No reply (${r.reason}).`)
  return finish($, q, h.text, 'haiku', `${main ? 'partial' : 'no main'} context · ${costOf(h.usage, since)}`)
}

// Saved threads live in the plugin's store, so they outlast /clear and the session.
const loadThreads = async ($: EngineInterface) => ((await $.store.get('threads')) as SideThread[] | undefined) ?? []

// How many threads are saved, for the header line: read once, then kept in step by save().
let savedCount: number | undefined

const countSaved = async ($: EngineInterface) => (savedCount ??= (await loadThreads($)).length)

async function save($: EngineInterface) {
  const list = await read($, turns)
  if (!list.length) return
  let t = await read($, thread)
  if (!t.id) {
    t = { id: String(Date.now()), started: new Date().toISOString().slice(0, 16).replace('T', ' ') }
    await update($, thread, () => t)
  }
  const entry: SideThread = { ...t, title: list[0].q.slice(0, 60), turns: list, root: await $.session.root(), session: await $.session.id() }
  const rest = (await loadThreads($)).filter(x => x.id !== t.id)
  const kept = [entry, ...rest].slice(0, MAX_THREADS)
  await $.store.set('threads', kept)
  savedCount = kept.length
}

const asText = (list: SideTurn[]) => list.map(t => `Q: ${t.q}\nA: ${t.a}`).join('\n\n')

type How = 'copy' | 'draft' | 'send'

// Copy, Draft and Send, for one answer or (with `all`) the whole thread.
async function act($: EngineInterface, how: How, text: string) {
  if (!text) return 'Nothing to ' + how + ' yet.'
  if (how === 'copy') {
    const r = await $.process.run(['pbcopy'], { stdin: text })
    return r.exitCode === 0 ? 'Copied.' : `Copy failed: ${r.stderr.trim() || r.exitCode}`
  }
  if (how === 'draft') {
    const r = await $.prompt.fill({ text, mode: 'append' })
    return r.isFilled ? 'Added to the main prompt.' : 'The main prompt is not available right now.'
  }
  void $.prompt.submit({ text })
  return 'Sent to the main chat.'
}

// Fork: a background fork of the main conversation takes the question and answer on, with full tools.
// f agents have full tools and run in the same folder as the main session, so the two can edit the same file at once and neither sees the other's edits.
// It is exempt from the read-only guard in the tool.call hook below on purpose; do not route it through that guard.
async function forkOut($: EngineInterface, t: SideTurn) {
  const r = await $.agent.spawn({
    subagentType: 'fork',
    description: FORK_DESC,
    prompt: `The person asked this in a side chat and wants you to act on it now, in the background, with your tools.\nQuestion: ${t.q}\nAnswer from the side chat: ${t.a}\nThe answer was given without running anything, so check it against the project before relying on it.`,
  })
  return r.deny === undefined ? 'Fork started in the background, with full tools.' : `Could not start the fork: ${r.deny}.`
}

// A request is tagged by round when it starts, so every thread reset (/clear, /new, picking a thread in /history) calls this too:
// the bump drops a late answer, which a fork cannot be cancelled to stop, instead of letting it land in the new thread. Do not remove those calls.
async function stop($: EngineInterface) {
  round++
  fallback.abort()
  // Release an ask waiting on an agent; it sees the new round and drops the answer.
  for (const done of waiting.values()) done('')
  waiting.clear()
  started.clear()
  await update($, pending, () => '')
}

async function flash($: EngineInterface, text: string) {
  await update($, notice, () => text)
  $.clock.after(3000, () => void update($, notice, () => ''))
  return text
}

// "clear" and "close" work from /side, /btw and the pane's own input, none of which need the mouse.
async function control($: EngineInterface, word: string) {
  const pick = /^model(?:\s+(\S+))?$/.exec(word)
  if (pick) {
    const wanted = pick[1]
    if (!wanted) return flash($, `Agent model: ${(await read($, model)) || defaultModel}. Change it with /model ${MODELS.join(' | ')}.`)
    if (!MODELS.includes(wanted)) return flash($, `Unknown model "${wanted}". Use ${MODELS.join(', ')}.`)
    await update($, model, () => wanted)
    return flash($, `Agent model set to ${wanted}.`)
  }
  const verb = /^(copy|draft|send)(\s+all)?$/.exec(word)
  if (verb) {
    const list = await read($, turns)
    const text = verb[2] ? asText(list) : (list.at(-1)?.a ?? '')
    return flash($, await act($, verb[1] as How, text))
  }
  if (word === 'new') {
    await stop($)
    await save($)
    await update($, turns, () => [])
    await update($, opened, () => [])
    await update($, picked, () => -1)
    await update($, thread, () => ({ id: '', started: '' }))
    return 'New side thread. The last one is in /history.'
  }
  if (word === 'history') {
    if (!(await countSaved($))) return 'No saved side threads yet.'
    await update($, picking, () => true)
    return 'Pick a thread in the pane.'
  }
  if (word === 'clear') {
    await stop($)
    await update($, turns, () => [])
    await update($, opened, () => [])
    await update($, picked, () => -1)
    await update($, thread, () => ({ id: '', started: '' }))
    return 'Side chat cleared.'
  }
  if (word === 'close') {
    await $.ui.close({ id: PANE })
    return 'Side chat closed. /btw reopens it.'
  }
}

// Returns {} not { text }: a command's text is a transcript row the main model reads.
async function run($: EngineInterface, e: { args: string }) {
  const arg = e.args.trim()
  const done = await control($, arg)
  if (done) {
    $.ui.toast(done)
    return {}
  }
  await $.ui.open({ id: PANE, title: 'Side chat', ...(takeKeyboard ? { focus: true as const } : {}) })
  if (arg) void ask($, arg)
  return {}
}

// Buttons and the input are answered here, by key, rather than by the elements' closures,
// which core can lose when a press lands during a redraw.
// The elements' own handlers; the ui.press and ui.input hooks answer first.
const noop = () => {}

// The picked card's index, or -1 with no cards; a picked of -1 is the newest.
const selectedOf = (list: SideTurn[], p: number) => (list.length ? (p < 0 ? list.length - 1 : Math.min(p, list.length - 1)) : -1)

async function press($: EngineInterface, key: string) {
  const [name, n] = key.split('-')
  if (name === 'clear') return void (await control($, 'clear'))
  // The main session's own /clear; the side thread is left alone.
  if (name === 'mainclear') return void $.command.run({ command: 'clear' }).catch(err => flash($, `/clear failed: ${err?.message ?? err}`))
  if (name === 'close') return void (await $.ui.close({ id: PANE }))
  if (name === 'stop') return stop($)
  if (name === 'chip') return void ask($, CHIPS[Number(n)].q)
  // f agents have full tools and run in the same folder as the main session: the two can edit the same file at once and neither sees the other's edits.
  if (name === 'fork') {
    const t = (await read($, turns))[+n]
    if (t) await flash($, await forkOut($, t))
    return
  }
  if (name === 'older' || name === 'newer') {
    const list = await read($, turns)
    const selected = selectedOf(list, await read($, picked))
    const to = name === 'older' ? Math.max(0, selected - 1) : Math.min(list.length - 1, selected + 1)
    return void update($, picked, () => (to === list.length - 1 ? -1 : to))
  }
  if (name === 'fold') return void update($, opened, o => (o.includes(+n) ? o.filter(x => x !== +n) : [...o, +n]))
  if (['copy', 'draft', 'send'].includes(name)) {
    const t = (await read($, turns))[+n]
    if (t) await flash($, await act($, name as How, t.a))
  }
}

export const register: Register = (on, options) => {
  const you = String(options.yourColor)
  custom = String(options.instructions ?? '').trim()
  takeKeyboard = options.takeKeyboard !== false
  defaultModel = String(options.agentModel ?? 'haiku')

  // Hand a started side-chat agent its answer; every hook sees a subagent's turn, so pass the event on.
  on('turn.start', async ($, e, next) => {
    if (e.agentId) await remember($, e.agentId)
    if (!e.agentId) mainStep = undefined
    return next(e)
  })

  // Streaming hook: pass the event on and let the step run. Main-loop steps only (no agentId).
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) mainStep = e.index
    return yield* next(e)
  })

  on('ui.press', async ($, e, next) => {
    if (e.plugin !== 'side-chat' || e.requestId !== PANE || !/^(clear|mainclear|close|stop|chip|fold|copy|draft|send|fork|older|newer)(-|$)/.test(e.element)) return next(e)
    await press($, e.element)
    return { element: e.element }
  })

  on('ui.input', async ($, e, next) => {
    if (e.plugin !== 'side-chat' || e.element !== 'side-input') return next(e)
    if (e.kind === 'change') await update($, draft, () => e.value)
    else {
      await update($, draft, () => '')
      void ask($, e.value)
    }
    return { element: e.element, value: e.value }
  })

  // Side-chat agents only read. The engine lists who started each agent (spawnedBy), so this holds before spawn returns the id and after Stop.
  // The one exception is the Fork button's agent (FORK_DESC): f agents have full tools and run in the same folder as the main session, so the two can edit the same file at once and neither sees the other's edits. Do not remove the exception.
  on('tool.call', async ($, e, next) => {
    if (!e.agentId || !WRITERS.includes(e.tool)) return next(e)
    const mine = (await $.agent.list()).some(a => a.id === e.agentId && a.spawnedBy === 'side-chat' && a.description !== FORK_DESC)
    return mine ? { deny: `Side-chat agents are read-only, so ${e.tool} is blocked. Answer from what you can read.` } : next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) await remember($, e.agentId)
    if (!e.agentId) mainStep = undefined
    if (e.agentId && (started.has(e.agentId) || starting > 0)) {
      // Any ending counts, so the pane never hangs on an agent that failed or was aborted.
      const answer = e.reason === 'answer' ? e.answer : ''
      const done = waiting.get(e.agentId)
      if (done) {
        waiting.delete(e.agentId)
        done(answer)
      } else early.set(e.agentId, answer)
    }
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    savedCount = undefined
    known.clear()
    await $.command.register({
      name: 'side',
      description: 'Side chat: ask follow-ups without touching the main conversation',
    })
    return next(e)
  })

  // btw is a built-in; command.run fires for it too, and answering without next replaces it.
  for (const command of ['side', 'btw']) on('command.run', { command }, run)

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Input, Button, Markdown, Select } = $.ui.resolve(e)
    const list = await read($, turns)
    const busy = await read($, pending)
    const agentModel = (await read($, model)) || defaultModel
    const typed = await read($, draft)
    const note = await read($, notice)
    const total = await countSaved($)
    const pick = (await read($, picking)) && total > 0
    // The list itself is only needed while the picker is open.
    const here = pick ? await $.session.root() : ''
    // This project's threads first; the rest, and any saved before threads carried a project, after.
    const saved = pick ? (await loadThreads($)).sort((a, b) => Number(b.root === here) - Number(a.root === here)) : []
    // The c (copy) and f (fork) hotkeys sit on the selected card, the newest unless Older was pressed. Only one card carries them: two buttons on one hotkey, the later wins.
    const last = list.length - 1
    const selected = selectedOf(list, await read($, picked))
    const open = await read($, opened)
    return (
      <Box flexDirection="column">
        <Box position="absolute" top={0} right={0} gap={1}>
          <Button key="clear" label="Clear" onPress={noop} />
          <Button key="mainclear" label="/clear main" onPress={noop} />
          <Button key="close" label="Close" onPress={noop} />
        </Box>
        <Text bold>Side chat</Text>
        <Text dimColor>{total} saved (/history){note ? ' · ' + note : ''}</Text>
        <Text dimColor>/copy /draft /send [all] · /history /new · /model {agentModel} · Esc: main prompt</Text>
        {pick && (
          <Select
            key="history"
            label="Open thread"
            autoFocus
            options={saved.map(t => ({ value: t.id, label: `${t.started}  ${t.root === here ? '' : 'other · '}${t.title}` }))}
            onSelect={async id => {
              const t = saved.find(x => x.id === id)
              await update($, picking, () => false)
              if (!t) return
              await stop($)
              await save($)
              await update($, thread, () => ({ id: t.id, started: t.started }))
              await update($, turns, () => t.turns)
              await update($, opened, () => [])
              await update($, picked, () => -1)
            }}
          />
        )}
        {!list.length && !busy && <Text dimColor>Ask anything about this session. @agent question calls an agent; ^agent question answers from that agent's transcript.</Text>}
        {list.length > 1 && (
          <Box gap={1}>
            <Button key="older" label="Older" hotkey="o" onPress={noop} />
            <Button key="newer" label="Newer" hotkey="n" onPress={noop} />
            <Text dimColor>card {selected + 1} of {list.length}</Text>
          </Box>
        )}
        {list.map((t, i) => (
          <Box key={'turn-' + i} borderStyle="round" borderColor={list.length > 1 && i === selected ? you : 'gray'} paddingX={1} flexDirection="column">
            <Box gap={1}>
              <Box flexGrow={1}><Text bold color={you}>{t.q}</Text></Box>
              {t.via && <Text dimColor>{t.via}</Text>}
            </Box>
            {/* The buttons get their own wrapping row: sharing the question's row, a narrow pane (terminal under ~170 columns) dropped them, Fork included. */}
            <Box gap={1} flexWrap="wrap">
              {ACTIONS.map(a => (
                <Button key={a.name + '-' + i} label={a.label} plain hotkey={i === selected ? a.key : undefined} onPress={noop}>
                  <Text backgroundColor={a.bg} color={a.fg}>{' ' + a.label + ' '}</Text>
                </Button>
              ))}
            </Box>
            {(() => {
              const lines = t.a.split('\n')
              const long = lines.length > FOLD_LINES
              const shown = long && !open.includes(i) ? lines.slice(0, FOLD_LINES).join('\n') : t.a
              return (
                <Box flexDirection="column">
                  <Markdown key={i === last ? 'answer-last' : 'answer-' + i} text={shown.slice(0, 10000)} />
                  {long && (
                    <Button
                      key={'fold-' + i}
                      label={open.includes(i) ? 'less' : `more (${lines.length - FOLD_LINES} lines)`}
                      onPress={noop}
                    />
                  )}
                  {t.cost && <Text dimColor>{t.cost}</Text>}
                </Box>
              )
            })()}
          </Box>
        ))}
        {busy && (
          <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
            <Text bold color={you}>{busy}</Text>
            <Box gap={1}>
              <Text dimColor>Thinking...</Text>
              <Button key="stop" label="Stop" onPress={noop} />
            </Box>
          </Box>
        )}
        {!busy && (
          <Box gap={1} flexWrap="wrap">
            {CHIPS.map((c, i) => <Button key={'chip-' + i} label={c.label} onPress={noop} />)}
          </Box>
        )}
        <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
          {(typed.includes('\n') || typed.length > 40) && <Text dimColor>{typed}</Text>}
          <Input key="side-input" placeholder="Follow up..." submitLabel="ask" autoFocus={takeKeyboard && !pick ? true : undefined} onInput={noop} onSubmit={noop} />
        </Box>
      </Box>
    )
  })
}
