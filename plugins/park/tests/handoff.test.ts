import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'
import { HEADINGS, editedFiles, factsBlock, lastPrompts, parkPrompt, seedLine } from '../hooks/note'

const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const
const TURN = { answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const
const OK = { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } as const
type Engine = Parameters<TestBody>[0]

const msg = (role: 'user' | 'assistant', text: string, toolUses: { tool: string; input: Record<string, unknown> }[] = []) => ({
  role,
  text,
  toolUses: toolUses.map((u, i) => ({ tool_use_id: `u${i}`, ...u })),
})

// Stands for the host: a folder of files, the transcript, git, the question box and /clear.
const host = (on: On, opts: { git?: string | number; answer?: string | Error; clearFails?: boolean; store?: Record<string, unknown> } = {}) => {
  const files = new Map<string, { text: string; mtimeMs: number }>()
  const seen = { submitted: [] as string[], toasts: [] as string[], asks: [] as string[], cleared: 0 }
  const messages = [
    msg('user', 'first task'),
    msg('assistant', 'ok', [
      { tool: 'Edit', input: { file_path: '/repo/a.ts' } },
      { tool: 'Read', input: { file_path: '/repo/r.ts' } },
      { tool: 'Write', input: { file_path: '/repo/b.ts' } },
      { tool: 'Edit', input: { file_path: '/repo/a.ts' } },
    ]),
    msg('user', 'now fix the\nsecond thing'),
  ]
  mock.env(on, {})
  const clock = mock.clock(on, { now: 1000 })
  const store = new Map<string, unknown>(Object.entries(opts.store ?? {}))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('turn.complete', () => ({ text: 'done' }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('ui.status', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.messages', () => ({ value: messages }))
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.submit', (_, e) => {
    seen.submitted.push(e.text)
    return { text: e.text }
  })
  on('fs.list', () => ({
    value: [...files].map(([path, f]) => ({ name: path.split('/').pop() ?? '', kind: 'file', size: 1, mtimeMs: f.mtimeMs, isLink: false })),
  }))
  on('fs.read', (_, e) => {
    const f = files.get(e.path)
    if (f === undefined) throw new Error('ENOENT')
    return { value: f.text }
  })
  on('fs.write', (_, e) => {
    files.set(e.path, { text: e.text, mtimeMs: 5000 })
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    if (e.argv[0] === 'git') {
      const g = opts.git ?? ' M a.ts\n?? b.ts\n'
      return typeof g === 'number' ? { value: { ...OK, exitCode: g, stdout: '' } } : { value: { ...OK, stdout: g } }
    }
    return { value: { ...OK, stdout: '' } }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
    const q = e.questions[0].question
    seen.asks.push(q)
    if (opts.answer instanceof Error) throw opts.answer
    return { result: { questions: e.questions, answers: { [q]: opts.answer ?? 'Clear and continue' } }, text: '' }
  })
  on('command.run', { command: 'clear' }, () => {
    if (opts.clearFails) throw new Error('clear refused')
    seen.cleared++
    return { text: '' }
  })

  return Object.assign(seen, { files, clock, messages, store })
}

const settle = async (clock: { advance: (n: number) => Promise<void> }) => {
  for (let i = 0; i < 6; i++) await clock.advance(250)
}
const park = ($: Engine) => $.command.run({ command: 'park', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })

// Runs /park, then lets the model "write" the note and the turn end.
async function parkAndWrite($: Engine, seen: ReturnType<typeof host>, name = 'park-x.md', turn: Record<string, unknown> = {}) {
  await $.session.start(START)
  await park($)
  await settle(seen.clock)
  seen.files.set(`/repo/.park/${name}`, { text: '## Goal\nship it\n', mtimeMs: 2000 })
  await $.turn.complete({ ...TURN, ...turn })
  await settle(seen.clock)
}

test('the park request carries all ten headings in order', async ($, on) => {
  const seen = host(on)
  await $.session.start(START)
  await park($)
  await settle(seen.clock)
  const sent = seen.submitted[0] ?? ''
  expect(HEADINGS).toHaveLength(10)
  let at = -1
  for (const h of HEADINGS) {
    const next = sent.indexOf(h, at + 1)
    expect(next).toBeGreaterThan(at)
    at = next
  }
  expect(sent).toContain('There are no other agent tabs.')
})

test('parkPrompt keeps the agent tab list at the end', () => {
  expect(parkPrompt('.park', 'saved claude x').endsWith('Agent tabs after /park:\nsaved claude x')).toBe(true)
})

test('editedFiles lists changed files once; lastPrompts skips the park request and the seed line', () => {
  const m = [
    msg('user', 'one'),
    msg('assistant', 'x', [{ tool: 'Edit', input: { file_path: '/a' } }, { tool: 'Read', input: { file_path: '/r' } }, { tool: 'Edit', input: { file_path: '/a' } }]),
    msg('user', 'Park this session.\n1. Save'),
    msg('user', 'Read .park/park-x.md and follow it.'),
    ...['two', 'three', 'four', 'five', 'six'].map(t => msg('user', t)),
  ]
  expect(editedFiles(m)).toEqual(['/a'])
  expect(lastPrompts(m, 5)).toEqual(['two', 'three', 'four', 'five', 'six'])
  expect(lastPrompts([msg('user', 'only')], 5)).toEqual(['only'])
})

test('factsBlock leaves out a part that is missing', () => {
  const full = factsBlock({ files: ['/a'], git: ' M a\n', prompts: ['hi'] })
  expect(full).toContain('- /a')
  expect(full).toContain(' M a')
  expect(full).toContain('> hi')
  expect(factsBlock({ files: [], prompts: [] })).not.toContain('git status')
  expect(seedLine('.park', 'park-x.md')).toBe('Read .park/park-x.md and follow it.')
})

test('after the note is written the Facts block is appended: edited files, git status, last prompts', async ($, on) => {
  const seen = host(on, { answer: 'Stay here' })
  await parkAndWrite($, seen)
  const note = seen.files.get('/repo/.park/park-x.md')?.text ?? ''
  expect(note.startsWith('## Goal\nship it\n')).toBe(true)
  const facts = note.slice(note.indexOf('## Facts (from code, not from the model)'))
  expect(note.trimEnd().endsWith('> second thing')).toBe(true)
  expect(facts).toContain('- /repo/a.ts')
  expect(facts).toContain('- /repo/b.ts')
  expect(facts).not.toContain('r.ts')
  expect(facts).toContain(' M a.ts')
  expect(facts).toContain('?? b.ts')
  expect(facts).toContain('> now fix the')
  expect(facts).toContain('> first task')
})

test('Clear and continue: /clear runs, the new chat opens with the note, the stored path is gone', async ($, on) => {
  const seen = host(on)
  await parkAndWrite($, seen)
  expect(seen.asks).toEqual(['Note saved. Continue in a fresh chat?'])
  expect(seen.cleared).toBe(1)

  await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} as never })
  await settle(seen.clock)
  expect(seen.submitted.at(-1)).toBe('Read .park/park-x.md and follow it.')
  expect(seen.submitted.filter(t => t.startsWith('Read .park/'))).toHaveLength(1)
  expect(seen.store.has('park.seed')).toBe(false)
})

test('Stay here: nothing is cleared and nothing is stored', async ($, on) => {
  const seen = host(on, { answer: 'Stay here' })
  await parkAndWrite($, seen)
  expect(seen.cleared).toBe(0)
  expect(seen.store.has('park.seed')).toBe(false)
  expect(seen.toasts).toEqual([])
})

test('Escape on the question counts as Stay here', async ($, on) => {
  const seen = host(on, { answer: new Error('dismissed') })
  await parkAndWrite($, seen)
  expect(seen.cleared).toBe(0)
  expect(seen.store.has('park.seed')).toBe(false)
  expect(seen.toasts).toEqual([])
})

test('a /clear that fails leaves the chat as it was, with one toast and no stored path', async ($, on) => {
  const seen = host(on, { clearFails: true })
  await parkAndWrite($, seen)
  expect(seen.toasts).toEqual(['Could not clear the chat. Staying here.'])
  expect(seen.store.has('park.seed')).toBe(false)
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} as never })
  await settle(seen.clock)
  expect(seen.submitted.filter(t => t.startsWith('Read .park/'))).toEqual([])
})

test('outside a git repo the Facts block simply omits git status, and there is no herdr', async ($, on) => {
  const seen = host(on, { git: 128, answer: 'Stay here' })
  await parkAndWrite($, seen)
  const note = seen.files.get('/repo/.park/park-x.md')?.text ?? ''
  expect(note).toContain('## Facts (from code, not from the model)')
  expect(note).toContain('- /repo/a.ts')
  expect(note).not.toContain('git status')
})

test('an interrupted park turn adds no facts and asks nothing', async ($, on) => {
  const seen = host(on)
  await parkAndWrite($, seen, 'park-x.md', { isAborted: true, reason: 'aborted' })
  expect(seen.asks).toEqual([])
  expect(seen.files.get('/repo/.park/park-x.md')?.text).toBe('## Goal\nship it\n')
})

test('a subagent turn ending first does not use up the park turn', async ($, on) => {
  const seen = host(on, { answer: 'Stay here' })
  await $.session.start(START)
  await park($)
  await settle(seen.clock)
  seen.files.set('/repo/.park/park-x.md', { text: 'n\n', mtimeMs: 2000 })
  await $.turn.complete({ ...TURN, agentId: 'sub1' })
  await settle(seen.clock)
  expect(seen.asks).toEqual([])
  await $.turn.complete(TURN)
  await settle(seen.clock)
  expect(seen.asks).toHaveLength(1)
})

test('a note rewritten under the same name is found by its new time', async ($, on) => {
  const seen = host(on, { answer: 'Stay here' })
  seen.files.set('/repo/.park/park-x.md', { text: 'old\n', mtimeMs: 100 })
  await $.session.start(START)
  await park($)
  await settle(seen.clock)
  seen.files.set('/repo/.park/park-x.md', { text: 'new\n', mtimeMs: 2000 })
  await $.turn.complete(TURN)
  await settle(seen.clock)
  expect(seen.files.get('/repo/.park/park-x.md')?.text).toContain('## Facts (from code')
})

test('no new note: one toast, no question', async ($, on) => {
  const seen = host(on)
  await $.session.start(START)
  await park($)
  await settle(seen.clock)
  await $.turn.complete(TURN)
  await settle(seen.clock)
  expect(seen.asks).toEqual([])
  expect(seen.toasts).toEqual(['No new note appeared in .park. Staying here.'])
})

test('a stored path left from long ago is not seeded into a later chat', async ($, on) => {
  const seen = host(on, { store: { 'park.seed': { note: 'park-old.md', at: -999_999 } } })
  await $.session.start(START)
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} as never })
  await settle(seen.clock)
  expect(seen.submitted).toEqual([])
  expect(seen.store.has('park.seed')).toBe(false)
})

test('a stored path survives until the new chat takes it, then is used once', async ($, on) => {
  const seen = host(on, { store: { 'park.seed': { note: 'park-y.md', at: 900 } } })
  await $.session.start(START)
  await settle(seen.clock)
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} as never })
  await settle(seen.clock)
  expect(seen.submitted.filter(t => t === 'Read .park/park-y.md and follow it.')).toHaveLength(1)
})
