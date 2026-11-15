// noticeboard: a side pane that does nothing until /board is typed. /board explains the
// question at the end of Claude's latest reply, and you can explore any option: the mod forks
// the real session at that question, plays the answer out in the fork, and shows the next
// question. Each branch is its own session, so nothing you explore reaches the main
// conversation. /board send lets Claude pin what you ask for (a table, a diagram, a summary)
// on the board with its pin tool. Based on decision-tree by Ray Amjad (MIT, see LICENSE).

const PANE = 'noticeboard'
const TITLE = 'Notice board'
const TOOL = 'mcp__noticeboard__pin'
// ponytail: pins live in module memory, capped; move them to $.state if they must survive a reload
const MAX_PINS = 20

// The answer every explanation is asked for, so the pane can draw it
const SHAPE = '{"question": "the question in one plain line", ' +
  '"context": "one or two sentences: what I need to know to decide", ' +
  '"options": [{"label": "2 to 5 words", "detail": "what it means", ' +
  '"leadsTo": "what happens next if I pick it", "pros": ["short"], "cons": ["short"]}], ' +
  '"recommendation": {"label": "the label of one option", "why": "one sentence"}}'

// The pin tool, registered only by /board send, so a session that never asks has no such tool
const PIN_SPEC = {
  name: 'pin',
  description: 'Pin markdown (a table, a plain-text diagram, a summary) on the notice board, the side pane ' +
    'beside the chat, for the person to read while the conversation goes on. Call it only when the person ' +
    'asks to put, send or pin something on the board or in the pane. Put the whole content in markdown and ' +
    'do not repeat it in your reply. Mermaid blocks show as source there, so draw diagrams in plain text.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'A short title, 2 to 6 words' },
      markdown: { type: 'string', description: 'The content to pin, as markdown' },
    },
    required: ['title', 'markdown'],
  },
}

// The tree for the latest question. A node is { sid, msgId, answer, status, data, children }:
// sid and msgId say which session, cut at which message, a branch below it forks from
let root = null
// Option indexes from the root to the node the pane shows
let path = []
// What the pane shows: 'node' (one question), 'map' (the whole tree) or 'pins' (what Claude pinned)
let view = 'node'
// Where the session transcripts live, from the Stop hook
let transcriptPath = ''
// The latest reply, explained only when /board is typed
let lastAnswer = null
// What Claude pinned, oldest first, the one the board shows, and whether pinning is on
let pins = []
let at = 0
let pinning = false

// The first explanation: a model fork replays the conversation and returns the choice as JSON
async function explainRoot($, answer) {
  const node = { sid: await $.session.id(), answer, status: 'thinking', children: [] }
  root = node
  path = []
  view = 'node'
  await openPane($, false)
  $.ui.invalidate('ui.render')

  const r = await $.model.fork({
    prompt: 'Your last reply ended by asking me a question. Do not answer it and do not use tools. ' +
      'Help me answer it. Reply with JSON only, no code fence, in this shape: ' + SHAPE + '. ' +
      'Use the options you offered; if you offered none, give the 2 to 4 answers I would most ' +
      'likely pick. At most 2 pros and 2 cons each. No em or en dashes.',
  })
  settle(node, r.isAnswered ? r.text : '', r.isAnswered ? 'the fork did not return JSON' : r.reason)
  if (root !== node) return
  $.ui.invalidate('ui.render')
}

// Explore option i of the node the pane shows: fork the real session at that node's
// question, tell the fork we picked i, and let it play that out with read-only tools.
// With own, the answer is yours: it joins the question's options first, then is explored
async function explore($, i, own) {
  const tree = root
  const node = nodeAt(path)
  if (own && node && node.data && node.data.options) {
    const options = node.data.options
    i = options.findIndex(o => o.label.toLowerCase() === own.toLowerCase())
    if (i < 0) i = options.push({ label: own, mine: true }) - 1
  }
  const option = node && node.data && node.data.options && node.data.options[i]
  if (!option) return $.ui.toast('noticeboard: no option ' + String.fromCharCode(65 + i) + ' here')
  path = [...path, i]
  view = 'node'
  $.ui.invalidate('ui.render')
  if (node.children[i]) return

  const child = { label: option.label, status: 'exploring', children: [], startedAt: Date.now() }
  node.children[i] = child

  // The message to cut the parent session at: the reply that asked this question
  if (!node.msgId) node.msgId = await lastAssistantId($, node.sid, node.answer)
  if (!node.msgId) $.ui.log('noticeboard: message id not found, forking from the latest point')
  const args = ['claude', '-p', whatIf(option),
    '--resume', node.sid, '--fork-session', '--output-format', 'json',
    '--permission-mode', 'default', '--allowedTools=Read,Grep,Glob',
    '--disallowedTools=Bash,Edit,Write,NotebookEdit']
  if (node.msgId) args.push('--resume-session-at', node.msgId)

  let out = null
  try {
    const run = await $.process.run(args, {
      cwd: await $.session.cwd(),
      env: { NOTICEBOARD_CHILD: '1' },
      timeoutMs: 300000,
    })
    out = resultOf(run.stdout)
    if (!out) child.reason = (run.stderr || run.stdout || 'no output').slice(0, 300)
  } catch (err) {
    child.reason = String(err)
  }
  if (root !== tree) return
  if (out) {
    child.sid = out.session_id
    child.answer = out.result
    settle(child, out.result || '', 'the branch did not return JSON')
  } else {
    child.status = 'failed'
  }
  child.ms = Date.now() - child.startedAt
  $.ui.invalidate('ui.render')
}

// The prompt a branch gets: our answer, then the same JSON as the root plus what happened
function whatIf(option) {
  return 'WHAT-IF BRANCH: this is a forked copy of the session for exploring one answer. ' +
    'The real session is not affected. My answer to your question: "' + option.label + '"' +
    (option.detail ? ' (' + option.detail + ')' : '') + '. Carry on as if I picked it, but change no files and run no ' +
    'commands; you may Read, Grep and Glob to make the plan concrete. Then reply with JSON only, ' +
    'no code fence, in this shape, plus two more fields: "outcome" (two to four sentences: what ' +
    'you would do and how things stand after) and "steps" (up to 4 short concrete steps). ' +
    'The question and options are the NEXT decision you would need from me after this; if there ' +
    'is none, give an empty question and options []. Shape: ' + SHAPE + '. No em or en dashes.'
}

// Turn a reply into the node's data, or mark the node failed
function settle(node, text, reason) {
  const data = parseJson(text)
  if (data && Array.isArray(data.options)) {
    node.data = data
    node.status = 'ready'
  } else {
    node.status = 'failed'
    node.reason = node.reason || reason
  }
}

// claude -p --output-format json prints the result object, or the whole event list
function resultOf(stdout) {
  try {
    const out = JSON.parse(stdout)
    const res = Array.isArray(out) ? out.find(x => x.type === 'result') : out
    return res && res.session_id ? res : null
  } catch {
    return null
  }
}

// Find the id of the assistant message that asked the question, in the session's transcript
async function lastAssistantId($, sid, answer) {
  // The Stop hook's transcript path names the folder; without it, rebuild it from the cwd
  const folder = transcriptPath ? transcriptPath.replace(/\/[^/]+$/, '') :
    (await $.env.get('HOME')) + '/.claude/projects/' + (await $.session.cwd()).replace(/[^a-zA-Z0-9]/g, '-')
  const file = folder + '/' + sid + '.jsonl'
  if (!(await $.fs.exists(file))) return undefined
  const lines = (await $.fs.read(file)).split('\n')
  const want = (answer || '').trim().slice(-60)
  for (let n = lines.length - 1; n >= 0; n--) {
    let row
    try { row = JSON.parse(lines[n]) } catch { continue }
    if (row.type !== 'assistant' || row.isSidechain) continue
    const text = (row.message.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
    if (text && text.trim().endsWith(want)) return row.uuid
  }
  return undefined
}

// The map: one row per question and per option, drawn as a tree with the path to each row
// Question: Which storage?
// ├ A JSON file on disk ▸
// │ └ Q: How should I build it?
// └ B SQLite ★
function mapRows(node, p, prefix, rows) {
  const data = node.data
  if (!data || !data.question) return rows
  rows.push({ text: prefix + 'Q: ' + data.question, path: p, kind: 'question' })
  const pick = (data.recommendation && data.recommendation.label) || ''
  data.options.forEach((o, i) => {
    const last = i === data.options.length - 1
    const child = node.children[i]
    const mark = !child ? '' : child.status === 'exploring' ? '  ...' : child.status === 'failed' ? '  ✗' : '  ▸'
    rows.push({
      text: prefix + (last ? '└ ' : '├ ') + String.fromCharCode(65 + i) + ' ' + o.label + (o.label === pick ? ' ★' : '') + (o.mine ? ' ✎' : '') + mark,
      path: child ? [...p, i] : null,
      kind: child ? 'explored' : 'option',
    })
    if (child && child.status === 'ready') mapRows(child, [...p, i], prefix + (last ? '  ' : '│ '), rows)
  })
  return rows
}

function nodeAt(p) {
  let node = root
  for (const i of p) node = node && node.children[i]
  return node
}

// Continue a branch for real: a new Claude session forked from it, in a Herdr pane if there is one
async function continueBranch($, node) {
  if (!node || !node.sid) return
  const command = 'claude --resume ' + node.sid + ' --fork-session'
  if ((await $.env.get('HERDR_ENV')) === '1') {
    try {
      const split = await $.process.run(['herdr', 'pane', 'split', '--current', '--direction', 'down',
        '--cwd', await $.session.cwd(), '--no-focus'])
      const id = JSON.parse(split.stdout).result.pane.pane_id
      await $.process.run(['herdr', 'pane', 'run', id, command])
      return $.ui.toast('noticeboard: branch opened in pane ' + id)
    } catch (err) {
      $.ui.log('could not open a Herdr pane: ' + err)
    }
  }
  await $.ui.copy({ text: command })
  $.ui.toast('noticeboard: copied ' + command)
}

// Open the side pane; resolves whether it is placed. Unasked, Claude Code only places it on a wide terminal.
async function openPane($, asked) {
  // focus takes only true, so leave it out for an unasked open
  const pane = { id: PANE, title: TITLE }
  // Asked from /board: take the keys, Escape closes it, and ask for room above the prompt
  const opened = await $.ui.open(asked ? { ...pane, focus: true, closeOnEscape: true, rows: 30 } : pane)
  return opened.isPlaced
}

// The fork may wrap its JSON in prose or a fence; take the outermost braces
function parseJson(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'board',
      description: 'Notice board: explain the latest question (A to H explores an option); send lets Claude pin things here',
      argumentHint: '[A-H | other <answer> | map | back | top | continue | send | send off | off]',
      immediate: true,
    })
    return next(e)
  })

  // Remember where transcripts are written, to find message ids to fork at
  on('classic.Stop', async ($, e, next) => {
    if (e.transcript_path) transcriptPath = e.transcript_path
    return next(e)
  }).catch(($, e, next) => (next.called ? undefined : next(e)))

  // After each of Claude's replies: remember it, nothing else; /board explains it
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // A branch's own claude -p run never explains its own replies
    if ((await $.env.get('NOTICEBOARD_CHILD')) === '1') return result
    if (e.agentId || e.reason !== 'answer') return result
    lastAnswer = e.answer
    return result
  })

  // Claude pins something: kept on the board, which opens on it
  on('tool.call', { tool: TOOL }, async ($, e) => {
    if (!pinning) return { result: 'The notice board is not taking pins. Ask the person to type /board send first.' }
    pins.push({ title: String(e.title || 'Untitled'), markdown: String(e.markdown || '') })
    if (pins.length > MAX_PINS) pins.shift()
    at = pins.length - 1
    view = 'pins'
    $.ui.invalidate('ui.render')
    const where = pins.length + ' of ' + pins.length
    if (!(await openPane($, false))) {
      $.ui.toast('noticeboard: type /board send to see the board')
      return { result: 'Pinned (' + where + '), but the board cannot open at this terminal width. The person can type /board send to open it.' }
    }
    return { result: 'Pinned on the notice board (' + where + ').' }
  })

  // /board explains the latest question; /board B explores option B; send, back, top and continue
  on('command.run', { command: 'board' }, async ($, e) => {
    const raw = (e.args || '').trim()
    const arg = raw.toLowerCase()
    if (arg === 'off') {
      root = null
      path = []
      pins = []
      at = 0
      pinning = false
      await $.ui.close({ id: PANE }).catch(() => {})
      return {}
    }
    if (arg === 'send off') {
      pinning = false
      return { text: 'Claude can no longer pin on the notice board.' }
    }
    if (arg === 'send') {
      pinning = true
      await $.tool.register(PIN_SPEC)
      view = 'pins'
      $.ui.invalidate('ui.render')
      await openPane($, true)
      return {}
    }
    // A bare /board explains the latest reply (first time, or a newer reply since)
    if (!root || (!raw && lastAnswer && root.answer !== lastAnswer)) {
      if (!lastAnswer) return { text: 'No reply to explain yet.' }
      const work = explainRoot($, lastAnswer).catch(err => $.ui.log('noticeboard failed: ' + err))
      if ((await $.env.get('NOTICEBOARD_WAIT')) === '1') await work
      await openPane($, true)
      return {}
    }
    view = arg === 'map' ? 'map' : 'node'
    if (arg === 'back') path = path.slice(0, -1)
    else if (arg === 'top') path = []
    else if (arg === 'continue') await continueBranch($, nodeAt(path))
    else if (/^[a-h]$/.test(arg) || /^other\s+\S/.test(arg)) {
      const own = /^other\s/.test(arg) ? raw.replace(/^other\s+/i, '') : undefined
      const work = explore($, own ? -1 : arg.charCodeAt(0) - 97, own).catch(err => $.ui.log('explore failed: ' + err))
      if ((await $.env.get('NOTICEBOARD_WAIT')) === '1') await work
    }
    $.ui.invalidate('ui.render')
    await openPane($, true)
    return {}
  })

  // The pane: what Claude pinned, or where you are in the tree, what the branch did, then the question and its options
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input, Markdown } = $.ui.resolve(e)
    const width = Math.max(30, (e.props.bodyColumns || 60) - 2)

    // The pins: one at a time, newest first shown, Older and Newer to move between them
    if (view === 'pins') {
      const pin = pins[at]
      return (
        <Box flexDirection="column" width={width}>
          {pin ? <Text dimColor>{'Pinned · ' + (at + 1) + ' of ' + pins.length}</Text> : null}
          {pin ? <Text bold color="cyan">{pin.title}</Text> :
            <Text dimColor>Nothing pinned yet. Ask Claude to put a table, a diagram or a summary here.</Text>}
          {pin ? <Markdown key="pin" text={pin.markdown} /> : null}
          <Box gap={2} marginTop={1}>
            {at > 0 ? <Button key="older" label="Older" onPress={() => { at -= 1; $.ui.invalidate('ui.render') }} /> : null}
            {at < pins.length - 1 ? <Button key="newer" label="Newer" onPress={() => { at += 1; $.ui.invalidate('ui.render') }} /> : null}
            {root ? <Button key="question" label="Question" onPress={() => { view = 'node'; $.ui.invalidate('ui.render') }} /> : null}
            <Button key="close" label="Close" onPress={() => $.ui.close({ id: PANE })} />
          </Box>
        </Box>
      )
    }

    const node = nodeAt(path)
    if (!root || !node) return <Text dimColor>Nothing to explain yet. Type /board after Claude asks you something.</Text>

    // The breadcrumb: Question › B SQLite › A WAL mode
    const crumbs = ['Question']
    let walk = root
    for (const i of path) {
      crumbs.push(String.fromCharCode(65 + i) + ' ' + walk.children[i].label)
      walk = walk.children[i]
    }
    const nav = (
      <Box gap={2} marginTop={1}>
        {path.length ? <Button key="back" label="Back" onPress={() => { path = path.slice(0, -1); $.ui.invalidate('ui.render') }} /> : null}
        {path.length > 1 ? <Button key="top" label="Top" onPress={() => { path = []; $.ui.invalidate('ui.render') }} /> : null}
        {node.sid && path.length ? <Button key="cont" label="Continue branch" onPress={() => continueBranch($, node)} /> : null}
        <Button key="map" label="Map" onPress={() => { view = 'map'; $.ui.invalidate('ui.render') }} />
        {pins.length ? <Button key="pins" label={'Pinned (' + pins.length + ')'} onPress={() => { view = 'pins'; $.ui.invalidate('ui.render') }} /> : null}
        <Button key="close" label="Close" onPress={() => $.ui.close({ id: PANE })} />
      </Box>
    )

    if (node.status === 'thinking') return <Text color="yellow">Reading the conversation to explain the question...</Text>

    // The map: the whole tree at once. Press a question or an explored option to open it.
    if (view === 'map') {
      const here = path.join('.')
      return (
        <Box flexDirection="column" width={width}>
          <Text bold>Map · ★ recommended · ▸ explored · ✎ yours</Text>
          <Text>{' '}</Text>
          {mapRows(root, [], '', []).map((row, n) => {
            // Mark the option you are on, or the first question when you are at the top
            const isHere = row.path && row.path.join('.') === here && (row.kind !== 'question' || !row.path.length)
            const text = (isHere ? '● ' : '  ') + row.text
            if (!row.path) return <Text key={'r' + n} dimColor>{text}</Text>
            return <Button key={'r' + n} plain label={text}
              onPress={() => { path = row.path; view = 'node'; $.ui.invalidate('ui.render') }} />
          })}
          <Box gap={2} marginTop={1}>
            <Button key="node" label="Back to question" onPress={() => { view = 'node'; $.ui.invalidate('ui.render') }} />
            <Button key="close" label="Close" onPress={() => $.ui.close({ id: PANE })} />
          </Box>
        </Box>
      )
    }
    if (node.status === 'exploring') {
      return (
        <Box flexDirection="column" width={width}>
          <Text dimColor>{crumbs.join(' › ')}</Text>
          <Text color="yellow">{'Forking the session and playing out "' + node.label + '"... (read-only, about 20 to 60s)'}</Text>
          {nav}
        </Box>
      )
    }
    if (node.status === 'failed') {
      return (
        <Box flexDirection="column" width={width}>
          <Text dimColor>{crumbs.join(' › ')}</Text>
          <Text color="red">Could not explain it: {String(node.reason)}</Text>
          {nav}
        </Box>
      )
    }

    const data = node.data
    const pick = (data.recommendation && data.recommendation.label) || ''
    return (
      <Box flexDirection="column" width={width}>
        <Text dimColor>{crumbs.join(' › ')}</Text>
        {path.length ? (
          <Box borderStyle="quote" borderColor="magenta" paddingLeft={1} flexDirection="column" marginBottom={1}>
            <Text bold color="magenta">{'If you pick ' + node.label}</Text>
            {data.outcome ? <Text>{data.outcome}</Text> : null}
            {(data.steps || []).map((s, j) => <Text key={'s' + j} color="blue">{(j + 1) + '. ' + s}</Text>)}
            <Text dimColor>{'branch session ' + String(node.sid).slice(0, 8) + (node.ms ? ' · ' + Math.round(node.ms / 1000) + 's' : '')}</Text>
          </Box>
        ) : null}
        {data.question ? (
          <Box borderStyle="double" borderColor="cyan" paddingX={1} flexDirection="column">
            <Text bold color="cyan">{data.question}</Text>
            {data.context ? <Text dimColor>{data.context}</Text> : null}
          </Box>
        ) : <Text dimColor>No further decision on this branch.</Text>}
        {data.options.map((o, i) => {
          const isPick = o.label === pick && !o.mine
          const child = node.children[i]
          const color = isPick ? 'green' : o.mine ? 'yellow' : 'gray'
          return (
            <Box key={'opt' + i} flexDirection="column">
              <Text dimColor>{'  │'}</Text>
              <Box borderStyle={isPick ? 'bold' : 'round'} borderColor={color} paddingX={1} flexDirection="column">
                <Text bold color={color === 'gray' ? 'white' : color}>{String.fromCharCode(65 + i) + '  ' + o.label + (isPick ? '   ★ recommended' : '') + (o.mine ? '   ✎ your answer' : '')}</Text>
                {o.detail ? <Text>{o.detail}</Text> : null}
                {o.leadsTo ? <Text color="blue">{'→ ' + o.leadsTo}</Text> : null}
                {(o.pros || []).map((p, j) => <Text key={'p' + j} color="green">{'+ ' + p}</Text>)}
                {(o.cons || []).map((c, j) => <Text key={'c' + j} color="red">{'- ' + c}</Text>)}
                <Button key={'x' + i} label={child ? (child.status === 'exploring' ? 'Exploring...' : 'Open branch ▸') : 'Explore ▸'}
                  onPress={() => explore($, i)} />
              </Box>
            </Box>
          )
        })}
        {data.question ? (
          <Box flexDirection="column">
            <Text dimColor>{'  │'}</Text>
            <Box borderStyle="round" borderColor="gray" borderDimColor paddingX={1} flexDirection="column">
              <Text dimColor bold>{String.fromCharCode(65 + data.options.length) + '  Other'}</Text>
              <Input key={'other.' + path.join('.')} placeholder="type your own answer" submitLabel="explore"
                onSubmit={value => { if (value.trim()) explore($, -1, value.trim()) }} />
            </Box>
          </Box>
        ) : null}
        {pick ? <Text>{' '}</Text> : null}
        {pick ? <Text color="green">{'★ ' + pick + ': ' + data.recommendation.why}</Text> : null}
        {nav}
      </Box>
    )
  })
}
