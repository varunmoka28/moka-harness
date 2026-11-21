import { test, expect, mock } from 'claude-code/testing'

const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const settle = () => new Promise(done => setTimeout(done, 100))
const mount = ($: any) => $.ui.mount({ plugin: 'side-chat', surface: 'terminal', component: 'Pane', props: {}, requestId: 'side-chat' } as never)
const ANSWER = 'Use **pnpm**.'

// One answered question, a prompt.submit that records its text, and a session that records appended rows.
async function host($: any, on: any) {
  mock.store(on)
  on('session.root', async () => ({ value: '/proj/a' }) as never)
  on('session.id', async () => ({ value: 's-a' }) as never)
  on('agent.list', async () => ({ value: [] }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.scroll', async () => ({}) as never)
  on('ui.toast', async () => ({ value: undefined }) as never)
  on('model.fork', async () => ({ value: { isAnswered: false, reason: 'nothing-to-fork' } }) as never)
  on('model.complete', async () => ({ value: { isAnswered: true, text: ANSWER, usage } }) as never)
  on('session.messages', async () => ({ value: [] }) as never)
  const submitted: string[] = []
  on('prompt.submit', async (_t: any, e: any) => {
    submitted.push(e.text)
    return { drop: 'test' } as never
  })
  const rows = mock.session(on)
  on('turn.start', async (_t: any, e: any) => ({ turnId: e.turnId }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
  await $.command.run({ command: 'btw', args: 'q' } as never)
  await settle()
  return { submitted, rows, m: await mount($) }
}

const appendedNotes = (rows: any) => rows.appended().filter((r: unknown) => JSON.stringify(r).includes('From my side chat'))

test('Now with only a subagent turn running is sent as a message, not appended as a note', async ($, on) => {
  const { submitted, rows, m } = await host($, on)
  await $.turn.start({ text: 'agent work', turnId: 'a-t1', agentId: 'a1' } as never)
  await m.press({ key: 'now-0' })
  expect(submitted).toEqual([ANSWER])
  expect(appendedNotes(rows)).toHaveLength(0)
})

test('Now with the main turn running appends once and submits nothing, even beside a subagent turn', async ($, on) => {
  const { submitted, rows, m } = await host($, on)
  await $.turn.start({ text: 'main work', turnId: 'm-t1' } as never)
  await $.turn.start({ text: 'agent work', turnId: 'a-t1', agentId: 'a1' } as never)
  await m.press({ key: 'now-0' })
  expect(appendedNotes(rows)).toHaveLength(1)
  expect(JSON.stringify(appendedNotes(rows))).toContain('From my side chat: ' + ANSWER)
  expect(submitted).toHaveLength(0)

  // The main turn ends while the subagent still runs: Now follows the main loop, so this press is a message.
  await $.turn.complete({ turnId: 'm-t1', reason: 'answer', answer: '', durationMs: 1, isAborted: false } as never)
  await m.press({ key: 'now-0' })
  expect(submitted).toEqual([ANSWER])
  expect(appendedNotes(rows)).toHaveLength(1)
})
