import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register } from 'claude-code'

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
const MAX_THREADS = 30
const HISTORY_SENT = 5
const FOLD_LINES = 12
const CHIPS = ['What are you doing?', 'Summarise the last reply', "What's next?"]
// Bumped by Stop: an answer from an older round is dropped. The engine has no way to cancel a fork or agent.
let round = 0
const PANE = 'side-chat'
const MODELS = ['default', 'haiku', 'sonnet', 'opus']
// The haiku fallback reads the main transcript's text, its tail cut to this.
const TRANSCRIPT_CHARS = 60000
// Main turns running now, by turnId, so "Now" knows whether there is a turn to join.
// ponytail: turn.start carries no agentId, so a subagent turn counts until it completes.
const turnsRunning = new Set<string>()

// Set from the instructions setting when the mod loads.
let custom = ''
let takeKeyboard = true
let defaultModel = 'haiku'

// Side turns are replayed inside each prompt because fork takes one message.
const buildPrompt = (history: SideTurn[], q: string, agents: string[]) =>
  [
    ...(custom ? [`The person's own instructions for this side chat: ${custom}`] : []),
    'The person asked the question at the end of this message in a side panel. Answer that question directly, in at most 6 short lines of plain markdown, using the conversation above. Never describe this message or these instructions. Read typos charitably. Use no tools.',
    "The main conversation's latest request may look unanswered: the main thread is still on it. Do not answer it or continue that work; answer only the side question.",
    ...(agents.length ? ['Agents running in this session right now:', ...agents] : []),
    ...history.flatMap(t => [`Earlier question: ${t.q}`, `Earlier answer: ${t.a}`]),
    `Question: ${q}`,
  ].join('\n')

// A started agent's answer arrives later as its turn.complete; `early` holds one that beat the wait.
const waiting = new Map<string, (answer: string) => void>()
const early = new Map<string, string>()
// Ids of agents this mod started: every other subagent's turn is none of its business.
const started = new Set<string>()
// Asks still waiting for spawn to return an id; an agent that finishes in that gap has no id on file yet.
let starting = 0
const answerOf = (id: string) =>
  early.has(id) ? Promise.resolve(early.get(id) as string) : new Promise<string>(done => waiting.set(id, done))

const kilo = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
// One dim line under an answer: time, and how much of the prompt the cache served.
const costOf = (u: ModelUsage, since: number) =>
  `${((Date.now() - since) / 1000).toFixed(1)}s · read ${kilo(u.cache_read_input_tokens)} · new ${kilo(u.input_tokens + u.cache_creation_input_tokens)} · out ${kilo(u.output_tokens)}`

async function finish($: EngineInterface, q: string, a: string, via?: SideTurn['via'], cost?: string) {
  await update($, turns, list => [...list, { q, a, ...(via ? { via } : {}), ...(cost ? { cost } : {}) }].slice(-50))
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
      prompt: `A side-chat question, answer in at most 8 short lines of plain text: ${q}`,
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

async function ask($: EngineInterface, q: string) {
  const word = q.trim().replace(/^\//, '')
  const done = await control($, word)
  if (done) return
  if (!q.trim() || (await read($, pending))) return
  const agent = /^@([\w-]+)\s+(.+)$/s.exec(q.trim())
  if (agent) return askAgent($, agent[1], agent[2])
  const history = (await read($, turns)).slice(-HISTORY_SENT)
  const running = (await $.agent.list())
    .filter(x => x.status === 'running' || x.status === 'pending' || x.status === 'waiting')
    .map(x => `- ${x.type} (${x.status}): ${x.description}`)
  const mine = ++round
  await update($, pending, () => q)
  const since = Date.now()
  const r = await $.model.fork({ prompt: buildPrompt(history, q, running) })
  if (mine !== round) return
  if (r.isAnswered) return finish($, q, r.text, 'fork', costOf(r.usage, since))
  // The fork failed (fresh or cleared session, API error): haiku answers from the transcript's text instead.
  const main = (await $.session.messages())
    .filter(m => m.text)
    .map(m => `${m.role}: ${m.text}`)
    .join('\n')
    .slice(-TRANSCRIPT_CHARS)
  const prompt = (main ? `The main conversation so far, as text only:\n${main}\n\n` : '') + buildPrompt(history, q, running)
  const h = await $.model.complete({ model: 'haiku', prompt, maxTokens: 2048 })
  if (mine !== round) return
  if (!h.isAnswered) return finish($, q, `No reply (${r.reason}).`)
  return finish($, q, h.text, 'haiku', `partial context · ${costOf(h.usage, since)}`)
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
  const entry: SideThread = { ...t, title: list[0].q.slice(0, 60), turns: list }
  const rest = (await loadThreads($)).filter(x => x.id !== t.id)
  const kept = [entry, ...rest].slice(0, MAX_THREADS)
  await $.store.set('threads', kept)
  savedCount = kept.length
}

const asText = (list: SideTurn[]) => list.map(t => `Q: ${t.q}\nA: ${t.a}`).join('\n\n')

type How = 'copy' | 'draft' | 'send' | 'now'

// Copy, Draft, Send and Now, for one answer or (with `all`) the whole thread.
async function act($: EngineInterface, how: How, text: string) {
  if (!text) return 'Nothing to ' + how + ' yet.'
  if (how === 'now') {
    if (!turnsRunning.size) {
      void $.prompt.submit({ text })
      return 'The main chat was idle, so it was sent as a message.'
    }
    // Joins the running turn: the model reads the row on its next request.
    const r = await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: `From my side chat: ${text}` }] } })
    if (r.deny === undefined) return 'Added to the running turn.'
    void $.prompt.submit({ text })
    return `Could not join the turn (${r.deny}); it is sent when the turn ends.`
  }
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

async function stop($: EngineInterface) {
  round++
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
  const verb = /^(copy|draft|send|now)(\s+all)?$/.exec(word)
  if (verb) {
    const list = await read($, turns)
    const text = verb[2] ? asText(list) : (list.at(-1)?.a ?? '')
    return flash($, await act($, verb[1] as How, text))
  }
  if (word === 'new') {
    await save($)
    await update($, turns, () => [])
    await update($, opened, () => [])
    await update($, thread, () => ({ id: '', started: '' }))
    return 'New side thread. The last one is in /history.'
  }
  if (word === 'history') {
    if (!(await countSaved($))) return 'No saved side threads yet.'
    await update($, picking, () => true)
    return 'Pick a thread in the pane.'
  }
  if (word === 'clear') {
    await update($, turns, () => [])
    await update($, opened, () => [])
    await update($, thread, () => ({ id: '', started: '' }))
    await update($, pending, () => '')
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

async function press($: EngineInterface, key: string) {
  const [name, n] = key.split('-')
  if (name === 'clear') return void (await control($, 'clear'))
  if (name === 'close') return void (await $.ui.close({ id: PANE }))
  if (name === 'stop') return stop($)
  if (name === 'chip') return void ask($, CHIPS[Number(n)])
  if (name === 'fold') return void update($, opened, o => (o.includes(+n) ? o.filter(x => x !== +n) : [...o, +n]))
  if (['copy', 'draft', 'send', 'now'].includes(name)) {
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
    turnsRunning.add(e.turnId)
    return next(e)
  })

  on('ui.press', async ($, e, next) => {
    if (e.plugin !== 'side-chat' || e.requestId !== PANE || !/^(clear|close|stop|chip|fold|copy|draft|send|now)(-|$)/.test(e.element)) return next(e)
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

  on('turn.complete', async ($, e, next) => {
    turnsRunning.delete(e.turnId)
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
    const saved = pick ? await loadThreads($) : []
    const last = list.length - 1
    const open = await read($, opened)
    return (
      <Box flexDirection="column">
        <Box position="absolute" top={0} right={0} gap={1}>
          <Button key="clear" label="Clear" onPress={noop} />
          <Button key="close" label="Close" onPress={noop} />
        </Box>
        <Text bold>Side chat</Text>
        <Text dimColor>{total} saved (/history){note ? ' · ' + note : ''}</Text>
        <Text dimColor>/copy /draft /send /now [all] · /history /new · /model {agentModel} · Esc: main prompt</Text>
        {pick && (
          <Select
            key="history"
            label="Open thread"
            autoFocus
            options={saved.map(t => ({ value: t.id, label: `${t.started}  ${t.title}` }))}
            onSelect={async id => {
              const t = saved.find(x => x.id === id)
              await update($, picking, () => false)
              if (!t) return
              await save($)
              await update($, thread, () => ({ id: t.id, started: t.started }))
              await update($, turns, () => t.turns)
              await update($, opened, () => [])
            }}
          />
        )}
        {!list.length && !busy && <Text dimColor>Ask anything about this session, or @agent your question to call an agent.</Text>}
        {list.map((t, i) => (
          <Box key={'turn-' + i} borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
            <Box gap={1}>
              <Box flexGrow={1}><Text bold color={you}>{t.q}</Text></Box>
              {t.via && <Text dimColor>{t.via}</Text>}
              <Button key={'copy-' + i} label="Copy" onPress={noop} />
              <Button key={'draft-' + i} label="Draft" onPress={noop} />
              <Button key={'send-' + i} label="Send" onPress={noop} />
              <Button key={'now-' + i} label="Now" onPress={noop} />
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
          <Box gap={1}>
            {CHIPS.map((c, i) => <Button key={'chip-' + i} label={c} onPress={noop} />)}
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
