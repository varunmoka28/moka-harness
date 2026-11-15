import { test, expect, mock } from 'claude-code/testing'

test('/side clear and typing /clear in the pane both wipe the chat', async ($, on) => {
  mock.store(on)
  const toasts: string[] = []
  on('ui.toast', async (_t: any, e: any) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  on('ui.render', async (t, e) => {
    const { Box } = t.ui.resolve(e)
    return <Box />
  })
  await $.command.run({ command: 'side', args: 'clear' } as never)
  expect(toasts).toEqual(['Side chat cleared.'])
  const m = await $.ui.mount({ plugin: 'side-chat', surface: 'terminal', component: 'Pane', props: {}, requestId: 'side-chat' } as never)
  await m.input({ key: 'side-input', text: '/clear' } as never)
  expect(await m.find({ key: 'side-input' })).toBeTruthy()
})
