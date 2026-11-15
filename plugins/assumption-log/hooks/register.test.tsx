import { expect, mock, test } from 'claude-code/testing'

const NOTE = 'mcp__assumption-log__note_assumption'
const START = { source: 'startup', cwd: '/r', isInteractive: true } as any
const PANE = { plugin: 'assumption-log', surface: 'terminal', component: 'Pane', requestId: 'assumption-log', props: {} } as any

const setup = (on: any) => {
  mock.clock(on, { now: 1_000_000 })
  const toasts: string[] = []
  on('session.start', async (_$: any, e: any) => e)
  on('session.end', async (_$: any, e: any) => e)
  on('command.register', async () => ({ value: undefined }) as any)
  on('tool.register', async () => ({ value: undefined }) as any)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as any)
  on('tool.call', { tool: 'Read' }, async () => ({ result: 'file' }) as any)
  on('ui.close', async () => ({ value: undefined }) as any)
  on('ui.toast', async (_$: any, e: any) => (toasts.push(JSON.stringify(e)), { value: undefined }) as any)
  return toasts
}
const note = ($: any, fields: Record<string, unknown>) => $.tool.call({ tool: NOTE, basis: 'b', affects: 'a', ...fields } as any)
const text = (r: any) => String(r.result ?? r.deny)

test('records an assumption, answers with its id, toasts it', async ($, on) => {
  const toasts = setup(on)
  await $.session.start(START)
  expect(text(await note($, { assumption: 'I took "the repo" to mean the frontend one' }))).toContain('Noted as A1')
  expect(toasts.join('')).toContain('frontend')
})

test('ids increase', async ($, on) => {
  setup(on)
  await $.session.start(START)
  expect(text(await note($, { assumption: 'one' }))).toContain('A1')
  expect(text(await note($, { assumption: 'two' }))).toContain('A2')
  expect(text(await note($, { assumption: 'three' }))).toContain('A3')
})

test('an empty assumption is refused and uses no id', async ($, on) => {
  setup(on)
  await $.session.start(START)
  expect((await note($, { assumption: '  ' })).deny).toBeDefined()
  expect(text(await note($, { assumption: 'real' }))).toContain('A1')
})

test('replaces marks the old one; a replaced one cannot be replaced twice', async ($, on) => {
  setup(on)
  await $.session.start(START)
  await note($, { assumption: 'old' })
  expect(text(await note($, { assumption: 'new', replaces: 'a1' }))).toContain('replacing A1')
  expect(text(await note($, { assumption: 'again', replaces: '1' }))).toContain('nothing was replaced')
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ text: /replaced by A2/ })).toBeDefined()
})

test('unknown, future or garbled replaces id is reported and replaces nothing', async ($, on) => {
  setup(on)
  await $.session.start(START)
  await note($, { assumption: 'first' })
  for (const bad of ['A2', 'A9', 'nonsense']) {
    expect(text(await note($, { assumption: 'x', replaces: bad }))).toContain('nothing was replaced')
  }
  expect(await (await $.ui.mount(PANE)).find({ text: /replaced by/ })).toBeUndefined()
})

test('a note the user rejected can still be replaced', async ($, on) => {
  setup(on)
  const filled: string[] = []
  on('prompt.fill', async (_$: any, e: any) => (filled.push(e.text), { isFilled: true }) as any)
  await $.session.start(START)
  await note($, { assumption: 'wrong guess' })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'reject-1' })
  expect(filled[0]).toContain('A1 is wrong')
  expect(text(await note($, { assumption: 'better', replaces: 'A1' }))).toContain('replacing A1')
})

test('panel says when empty, lists newest first, marks replaced ones', async ($, on) => {
  setup(on)
  await $.session.start(START)
  await note($, { assumption: 'first guess' })
  await note($, { assumption: 'second guess', replaces: 'A1' })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ text: /replaced by A2/ })).toBeDefined()
  const order = (await ui.findAll({ type: 'Text', text: /guess/ })).map((t: any) => t.text)
  expect(order.findIndex((t: string) => t.includes('second'))).toBeLessThan(order.findIndex((t: string) => t.includes('first')))
})

test('empty panel says so', async ($, on) => {
  setup(on)
  await $.session.start(START)
  expect(await (await $.ui.mount(PANE)).find({ text: /None yet/ })).toBeDefined()
})

test('/assumptions clear empties the list but never reuses an id', async ($, on) => {
  setup(on)
  await $.session.start(START)
  await note($, { assumption: 'one' })
  await $.command.run({ command: 'assumptions', args: 'clear' } as any)
  expect(text(await note($, { assumption: 'two' }))).toContain('A2')
})

test('ending the conversation (/clear, resume) starts a fresh list', async ($, on) => {
  setup(on)
  await $.session.start(START)
  await note($, { assumption: 'one' })
  await note($, { assumption: 'two' })
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } } as any)
  expect(text(await note($, { assumption: 'fresh' }))).toContain('A1')
})

test('/assumptions opens and closes the panel; other tools pass through', async ($, on) => {
  setup(on)
  await $.session.start(START)
  expect(JSON.stringify(await $.command.run({ command: 'assumptions', args: '' } as any))).toContain('opened')
  expect(JSON.stringify(await $.command.run({ command: 'assumptions', args: 'close' } as any))).toContain('closed')
  expect((await $.tool.call({ tool: 'Read' } as any)).result).toBe('file')
})

test('the prompt section tells Claude to use the tool', async ($, on) => {
  setup(on)
  on('prompt.compose', async () => ({ sections: [] }) as any)
  await $.session.start(START)
  const composed: any = await $.prompt.compose({ model: 'm', promptModel: 'm', outputStyle: null, tools: [], traits: [], surfaces: [] } as any)
  expect(JSON.stringify(composed)).toContain(NOTE)
})
