import { test, expect, mock } from 'claude-code/testing'

const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const settle = () => new Promise(done => setTimeout(done, 100))

// Mocks the host so every question is forked and answered by answer(); returns the prompts the fork received.
function setup(on: any, answer: string) {
  mock.store(on)
  on('session.root', async () => ({ value: '/proj/history' }) as never)
  on('session.id', async () => ({ value: 's-history' }) as never)
  on('agent.list', async () => ({ value: [] }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.scroll', async () => ({}) as never)
  on('ui.toast', async () => ({ value: undefined }) as never)
  const prompts: string[] = []
  on('model.fork', async (_t: any, e: any) => {
    prompts.push(e.prompt)
    return { value: { isAnswered: true, text: answer, usage } } as never
  })
  return prompts
}

async function askAll($: any, count: number) {
  for (let i = 1; i <= count; i++) {
    await $.command.run({ command: 'btw', args: `q${i}` } as never)
    await settle()
  }
}

test('the last 20 side turns go with a question, and no older ones', async ($, on) => {
  const prompts = setup(on, 'ok')
  await askAll($, 22)
  const last = prompts.at(-1)!
  expect(last).toContain('Earlier question: q2\n')
  expect(last).toContain('Earlier question: q21\n')
  expect(last).not.toContain('Earlier question: q1\n')
})

test('the 8000 character cap still trims inside the 20 turns', async ($, on) => {
  const prompts = setup(on, 'a'.repeat(1000))
  await askAll($, 25)
  const lines = prompts.at(-1)!.split('\n')
  const questions = lines.filter(l => l.startsWith('Earlier question: '))
  const answers = lines.filter(l => l.startsWith('Earlier answer: '))
  const chars = [...questions, ...answers].reduce((n, l) => n + l.slice(l.indexOf(': ') + 2).length, 0)
  expect(questions.length).toBeLessThan(20)
  expect(chars).toBeLessThanOrEqual(8000)
  expect(questions.at(-1)).toBe('Earlier question: q24')
})
