import { test, expect, mock } from 'claude-code/testing'

test('pane draws a follow-up input', async ($, on) => {
  mock.store(on)
  on('ui.render', async (t, e) => {
    const { Box } = t.ui.resolve(e)
    return <Box />
  })
  const m = await $.ui.mount({
    plugin: 'side-chat',
    surface: 'terminal',
    component: 'Pane',
    props: {},
    requestId: 'side-chat',
  } as never)
  expect(await m.find({ key: 'side-input' })).toBeTruthy()
})
