import { test, expect, mock } from 'claude-code/testing'

const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const settle = () => new Promise(done => setTimeout(done, 100))
const mount = ($: any) => $.ui.mount({ plugin: 'side-chat', surface: 'terminal', component: 'Pane', props: {}, requestId: 'side-chat' } as never)

// fork answers with `forked` (or does not answer when it is undefined, so haiku takes over); haiku answers with `haiku`.
function host(on: any, forked: string | undefined, haiku = 'unused') {
  mock.store(on)
  on('session.root', async () => ({ value: '/proj/toolnote' }) as never)
  on('session.id', async () => ({ value: 's-toolnote' }) as never)
  on('agent.list', async () => ({ value: [] }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.scroll', async () => ({}) as never)
  on('ui.toast', async () => ({ value: undefined }) as never)
  on('session.messages', async () => ({ value: [] }) as never)
  on('model.fork', (async () => ({
    value: forked === undefined ? { isAnswered: false, reason: 'nothing-to-fork' } : { isAnswered: true, text: forked, usage },
  })) as never)
  on('model.complete', (async () => ({ value: { isAnswered: true, text: haiku, usage } })) as never)
}

async function answerTo($: any, on: any, forked: string | undefined, haiku?: string) {
  host(on, forked, haiku)
  await $.command.run({ command: 'btw', args: 'what would you run?' } as never)
  await settle()
  return (await (await mount($)).find({ key: 'answer-last' }))?.text as string
}

test('an answer that writes tool calls as text gets the nothing-was-executed note', async ($, on) => {
  const text = await answerTo($, on, '<function_calls>\n<invoke name="Bash">')
  expect(text).toContain('invoke name="Bash"')
  expect(text).toContain('Nothing was executed')
})

test('a plain answer gets no note', async ($, on) => {
  const text = await answerTo($, on, 'Use **pnpm**.')
  expect(text).toContain('Use **pnpm**.')
  expect(text).not.toContain('Nothing was executed')
})

test('an answer that only talks about tools gets no note', async ($, on) => {
  const text = await answerTo($, on, 'The invoke helper is a tool you can call.')
  expect(text).toContain('The invoke helper')
  expect(text).not.toContain('Nothing was executed')
})

test('the haiku fallback gets the note too', async ($, on) => {
  const text = await answerTo($, on, undefined, '<tool_use>')
  expect(text).toContain('<tool_use>')
  expect(text).toContain('Nothing was executed')
})
