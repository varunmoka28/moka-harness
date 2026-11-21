import { test, expect, mock } from 'claude-code/testing'

const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const settle = () => new Promise(done => setTimeout(done, 100))
const RULE = 'If the question asks for a prompt'

// Returns the prompts the fork and the Haiku fallback were sent; forkAnswers false sends the question on to Haiku.
async function sent($: any, on: any, forkAnswers: boolean) {
  mock.store(on)
  on('session.root', async () => ({ value: '/proj/a' }) as never)
  on('session.id', async () => ({ value: 's-a' }) as never)
  on('agent.list', async () => ({ value: [] }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.scroll', async () => ({}) as never)
  on('session.messages', async () => ({ value: [{ role: 'user', text: 'fix the parser', toolUses: [] }] }) as never)
  const p = { fork: '', haiku: '' }
  on('model.fork', async (_t: any, e: any) => {
    p.fork = e.prompt
    return { value: forkAnswers ? { isAnswered: true, text: 'ok', usage } : { isAnswered: false, reason: 'nothing-to-fork' } } as never
  })
  on('model.complete', async (_t: any, e: any) => {
    p.haiku = e.prompt
    return { value: { isAnswered: true, text: 'ok', usage } } as never
  })
  await $.command.run({ command: 'btw', args: 'give me the prompt to send' } as never)
  await settle()
  return p
}

test('a side question that asks for a prompt gets only the prompt text, on the fork path', async ($, on) => {
  const p = await sent($, on, true)
  expect(p.fork).toContain(RULE)
  expect(p.fork).toContain('only that prompt text, with no intro, explanation or closing line')
})

test('the Haiku fallback carries the same prompt-only rule', async ($, on) => {
  const p = await sent($, on, false)
  expect(p.haiku).toContain(RULE)
  expect(p.haiku).toContain('only that prompt text, with no intro, explanation or closing line')
})
