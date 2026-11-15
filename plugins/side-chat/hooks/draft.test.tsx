import { test, expect, mock } from 'claude-code/testing'

test('a long draft is echoed in full above the one-line input', async ($, on) => {
  mock.store(on)
  const m = await $.ui.mount({ plugin: 'side-chat', surface: 'terminal', component: 'Pane', props: {}, requestId: 'side-chat' } as never)
  const long = 'first line of a long question\nsecond line that would otherwise be cut off'
  await m.input({ key: 'side-input', text: long, kind: 'change' } as never)
  expect(await m.find({ type: 'Text', text: /second line that would otherwise be cut off/ })).toBeDefined()
})
