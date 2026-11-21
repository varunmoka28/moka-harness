import { test, expect, mock } from 'claude-code/testing'

// Hotkeys are the one-letter route into a Pane (a Button's hotkey, pressed while the pane holds focus).
// Shift+Left/Right stepping between cards is not built: it needs a Client element that a click focuses, and
// every card is already on screen with its own Copy button. The mount cannot send a key to a Button or the
// Input, so whether a hotkey fires while the cursor is in the input is a live check, not tested here.

const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const settle = () => new Promise(done => setTimeout(done, 100))
const mount = ($: any) => $.ui.mount({ plugin: 'side-chat', surface: 'terminal', component: 'Pane', props: {}, requestId: 'side-chat' } as never)

// Three answered turns, each answer different; returns what pbcopy was given, in order.
async function threeTurns($: any, on: any) {
  mock.store(on)
  const answers = ['first answer', 'second answer', 'third answer']
  let n = 0
  on('session.root', async () => ({ value: '/proj/a' }) as never)
  on('session.id', async () => ({ value: 's-a' }) as never)
  on('agent.list', async () => ({ value: [] }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.scroll', async () => ({}) as never)
  on('ui.toast', async () => ({ value: undefined }) as never)
  on('model.fork', async () => ({ value: { isAnswered: false, reason: 'nothing-to-fork' } }) as never)
  on('session.messages', async () => ({ value: [] }) as never)
  on('model.complete', async () => ({ value: { isAnswered: true, text: answers[n++], usage } }) as never)
  const copied: string[] = []
  on('process.run', async (_t: any, e: any) => {
    if (e.argv[0] === 'pbcopy') copied.push(e.init.stdin)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  for (const q of ['one', 'two', 'three']) {
    await $.command.run({ command: 'btw', args: q } as never)
    await settle()
  }
  return copied
}

test('only the newest card carries the c hotkey on its Copy button', async ($, on) => {
  await threeTurns($, on)
  const m = await mount($)
  const hotkey = async (key: string) => (await m.find({ key }))?.props.hotkey
  expect(await hotkey('copy-2')).toBe('c')
  expect(await hotkey('copy-1')).toBeUndefined()
  expect(await hotkey('copy-0')).toBeUndefined()
})

test('pressing the Copy button of the newest card pipes the third answer, not the last-but-one', async ($, on) => {
  const copied = await threeTurns($, on)
  const m = await mount($)
  await m.press({ key: 'copy-2' })
  await settle()
  expect(copied).toEqual(['third answer'])
})

test('no two buttons in the pane share a hotkey', async ($, on) => {
  await threeTurns($, on)
  const m = await mount($)
  const keys = (await m.findAll({ type: 'Button' })).map(b => b.props.hotkey).filter(Boolean)
  expect(keys).toContain('c')
  expect(new Set(keys).size).toBe(keys.length)
})
