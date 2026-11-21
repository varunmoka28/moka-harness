import { test, expect, mock } from 'claude-code/testing'

const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const settle = () => new Promise(done => setTimeout(done, 100))
const mount = ($: any) => $.ui.mount({ plugin: 'side-chat', surface: 'terminal', component: 'Pane', props: {}, requestId: 'side-chat' } as never)

// Two answered turns in an open pane. The session cannot be forked, so haiku answers each from model.complete;
// forks counts model.fork calls, and spawned holds the raw agent.spawn events.
async function twoTurns($: any, on: any, spawn: () => unknown) {
  mock.store(on)
  mock.clock(on)
  on('session.root', async () => ({ value: '/proj/a' }) as never)
  on('session.id', async () => ({ value: 's-a' }) as never)
  on('agent.list', async () => ({ value: [] }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.scroll', async () => ({}) as never)
  on('session.messages', async () => ({ value: [] }) as never)
  const forks = { n: 0 }
  on('model.fork', async () => {
    forks.n++
    return { value: { isAnswered: false, reason: 'nothing-to-fork' } } as never
  })
  let text = ''
  on('model.complete', async () => ({ value: { isAnswered: true, text, usage } }) as never)
  const spawned: any[] = []
  on('agent.spawn', async (_t: any, e: any) => {
    spawned.push(e)
    return spawn() as never
  })
  for (const [q, a] of [['first question', 'first answer'], ['second question', 'second answer']]) {
    text = a
    await $.command.run({ command: 'btw', args: q } as never)
    await settle()
  }
  return { m: await mount($), forks, spawned }
}

test('Fork on a card starts one full-tools fork carrying that card, and says so in the header', async ($, on) => {
  const { m, forks, spawned } = await twoTurns($, on, () => ({ model: 'sonnet', agentId: 'f1' }))
  const before = forks.n
  await m.press({ key: 'fork-0' })
  await settle()
  expect(spawned.length).toBe(1)
  expect(spawned[0].subagent_type).toBe('fork')
  expect(spawned[0].description).toBe('side chat fork')
  expect(Object.keys(spawned[0])).not.toContain('model')
  expect(spawned[0].prompt).toContain('Question: first question')
  expect(spawned[0].prompt).toContain('Answer from the side chat: first answer')
  expect(spawned[0].prompt).not.toContain('second')
  expect(forks.n).toBe(before)
  expect(await m.find({ type: 'Text', text: /Fork started in the background, with full tools\./ })).toBeDefined()
})

test('card actions are coloured pills, Fork in magenta, and keep their keys', async ($, on) => {
  const { m } = await twoTurns($, on, () => ({ model: 'sonnet', agentId: 'f1' }))
  const fork = (await m.find({ type: 'Text', text: /^ Fork $/ })) as any
  expect(fork?.props.backgroundColor).toBe('magenta')
  expect(((await m.find({ type: 'Text', text: /^ Copy $/ })) as any)?.props.backgroundColor).toBe('cyan')
  expect(await m.find({ key: 'fork-0' })).toBeDefined()
})

test('a refused fork shows why in the header', async ($, on) => {
  const { m, spawned } = await twoTurns($, on, () => ({ deny: 'no slots left' }))
  await m.press({ key: 'fork-1' })
  await settle()
  expect(spawned.length).toBe(1)
  expect(await m.find({ type: 'Text', text: /Could not start the fork: no slots left\./ })).toBeDefined()
  expect(await m.find({ type: 'Text', text: /Fork started/ })).toBeUndefined()
})

test('the fork may write, an @agent may not', async ($, on) => {
  mock.store(on)
  on('agent.list', async () => ({
    value: [
      { id: 'f1', description: 'side chat fork', spawnedBy: 'side-chat' },
      { id: 'a1', description: 'side chat question', spawnedBy: 'side-chat' },
    ],
  }) as never)
  on('tool.call', async () => ({ result: 'ran', text: 'ran' }) as never)
  const call = (tool: string, agentId: string) => $.tool.call({ tool, agentId } as never) as Promise<{ deny?: string; text?: string }>
  for (const tool of ['Edit', 'Write', 'NotebookEdit', 'MultiEdit', 'Bash', 'Agent', 'REPL']) {
    expect((await call(tool, 'a1')).deny).toContain('read-only')
    const fork = await call(tool, 'f1')
    expect(fork.deny).toBeUndefined()
    expect(fork.text).toBe('ran')
  }
})

test('only the newest card has the f hotkey', async ($, on) => {
  const { m } = await twoTurns($, on, () => ({ model: 'sonnet', agentId: 'f1' }))
  expect((await m.find({ key: 'fork-0' }))?.props.hotkey).toBeUndefined()
  expect((await m.find({ key: 'fork-1' }))?.props.hotkey).toBe('f')
})
