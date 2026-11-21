import { test, expect, mock } from 'claude-code/testing'

const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const settle = () => new Promise(done => setTimeout(done, 100))
const mount = ($: any) => $.ui.mount({ plugin: 'side-chat', surface: 'terminal', component: 'Pane', props: {}, requestId: 'side-chat' } as never)

const row = (role: string, text: string) => ({ role, text, toolUses: [] })
const listed = (id: string, name: string, type: string) => ({ id, name, type, status: 'running', description: 'd' })

// The engine drops a finished subagent from agent.list() within seconds but still reads its transcript: world.agents is what the list returns now.
function host(on: any) {
  const world = { agents: [] as unknown[] }
  const seen = { read: [] as unknown[], prompts: [] as string[], forks: 0, spawns: 0 }
  mock.store(on)
  on('session.root', async () => ({ value: '/proj/a' }) as never)
  on('session.id', async () => ({ value: 's-a' }) as never)
  on('agent.list', async () => ({ value: world.agents }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.scroll', async () => ({}) as never)
  on('ui.toast', async () => ({ value: undefined }) as never)
  on('session.messages', async (_t: any, e: any) => {
    seen.read.push(e.agentId)
    return { value: [row('user', 'find the parser'), row('assistant', 'FOUND_IT in parser.ts')] } as never
  })
  on('model.complete', async (_t: any, e: any) => {
    seen.prompts.push(e.prompt)
    return { value: { isAnswered: true, text: 'It found the parser.', usage } } as never
  })
  on('model.fork', async () => {
    seen.forks++
    return { value: { isAnswered: false, reason: 'nothing-to-fork' } } as never
  })
  on('agent.spawn', async () => {
    seen.spawns++
    return { model: 'haiku', agentId: 'x' } as never
  })
  on('turn.start', async (_t: any, e: any) => ({ turnId: e.turnId }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
  return { seen, world }
}

const ask = async ($: any, args: string) => {
  await $.command.run({ command: 'btw', args } as never)
  await settle()
}

const complete = ($: any, agentId: string) =>
  $.turn.complete({ turnId: 't-' + agentId, agentId, reason: 'answer', answer: 'done', durationMs: 1, isAborted: false } as never)

test('^scout answers after scout has left agent.list', async ($, on) => {
  const { seen, world } = host(on)
  world.agents = [listed('a1', 'scout', 'Explore'), listed('a9', 'other', 'general-purpose')]
  await complete($, 'a1')
  world.agents = []
  await ask($, '^scout what did it find?')
  expect(seen.read).toEqual(['a1'])
  expect(seen.prompts).toHaveLength(1)
  expect(seen.prompts[0]).toContain('FOUND_IT in parser.ts')
  expect(seen.prompts[0].endsWith('Question: what did it find?')).toBe(true)
  expect(seen.forks + seen.spawns).toBe(0)
  expect((await (await mount($)).find({ key: 'answer-last' }))?.text).toContain('It found the parser.')
})

test('the type works too once the agent is gone', async ($, on) => {
  const { seen, world } = host(on)
  world.agents = [listed('a1', 'scout', 'Explore')]
  await complete($, 'a1')
  world.agents = []
  await ask($, '^Explore what did it find?')
  expect(seen.read).toEqual(['a1'])
  expect(seen.prompts[0]).toContain('FOUND_IT in parser.ts')
  expect(seen.forks + seen.spawns).toBe(0)
})

test('an agent recorded at turn.start is found even if it never completes', async ($, on) => {
  const { seen, world } = host(on)
  world.agents = [listed('a2', 'late', 'Explore')]
  await $.turn.start({ text: 'go', turnId: 't2', agentId: 'a2' } as never)
  world.agents = []
  await ask($, '^late what did it find?')
  expect(seen.read).toEqual(['a2'])
  expect((await (await mount($)).find({ key: 'answer-last' }))?.text).toContain('It found the parser.')
})

test('an agent that was never listed is still unknown, and the line names the remembered ones', async ($, on) => {
  const { seen, world } = host(on)
  world.agents = [listed('a1', 'scout', 'Explore')]
  await complete($, 'a1')
  world.agents = []
  await ask($, '^ghost what now?')
  expect((await (await mount($)).find({ key: 'answer-last' }))?.text).toContain('No agent called ghost. Agents now: scout.')
  expect(seen.read).toEqual([])
  expect(seen.prompts).toEqual([])
})
