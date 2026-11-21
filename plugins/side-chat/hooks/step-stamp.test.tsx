import { test, expect, mock } from 'claude-code/testing'

const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const settle = () => new Promise(done => setTimeout(done, 100))
const mount = ($: any) => $.ui.mount({ plugin: 'side-chat', surface: 'terminal', component: 'Pane', props: {}, requestId: 'side-chat' } as never)

// A fork that answers, and turn hooks that let main and subagent turns start, step and end.
function host($: any, on: any) {
  mock.store(on)
  on('session.root', async () => ({ value: '/proj/a' }) as never)
  on('session.id', async () => ({ value: 's-a' }) as never)
  on('agent.list', async () => ({ value: [] }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.scroll', async () => ({}) as never)
  on('ui.toast', async () => ({ value: undefined }) as never)
  on('model.fork', async () => ({ value: { isAnswered: true, text: 'Use pnpm.', usage } }) as never)
  on('session.messages', async () => ({ value: [] }) as never)
  on('turn.start', async (_t: any, e: any) => ({ turnId: e.turnId }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
  on('turn.step', async function* (_t: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })
}

const step = async ($: any, turnId: string, index: number, agentId?: string) => {
  for await (const _ of $.turn.step({ turnId, index, model: 'm', messageCount: 1, agentId } as never)) void _
}

// The dim cost line under each fork answer, oldest first.
const costLines = async (m: any) => (await m.findAll({ type: 'Text', text: /s · read 0 · new 0 · out 0$/ })).map((t: any) => String(t.text))

test('a fork answer started after step N carries the stamp for step N', async ($, on) => {
  host($, on)
  const m = await mount($)
  const ask = async () => {
    await $.command.run({ command: 'btw', args: 'q' } as never)
    await settle()
    const lines = await costLines(m)
    return lines[lines.length - 1]
  }

  // (a) no main turn running: no stamp
  expect(await ask()).not.toContain('as of step')

  // (b) main steps 0, 1, 2: the fork saw three requests, shown 1-based
  await $.turn.start({ text: 'main work', turnId: 'm-t1' } as never)
  for (const i of [0, 1, 2]) await step($, 'm-t1', i)
  expect(await ask()).toContain('as of step 3 · ')

  // (c) a subagent's step never moves it
  await step($, 'a-t1', 7, 'a1')
  const c = await ask()
  expect(c).toContain('as of step 3 · ')
  expect(c).not.toContain('step 8')

  // (d) the next main step does
  await step($, 'm-t1', 3)
  expect(await ask()).toContain('as of step 4 · ')

  // (e) the main turn ends: idle main shows no stamp
  await $.turn.complete({ turnId: 'm-t1', reason: 'answer', answer: '', durationMs: 1, isAborted: false } as never)
  expect(await ask()).not.toContain('as of step')
})
