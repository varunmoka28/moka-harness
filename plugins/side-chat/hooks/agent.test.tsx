import { test, expect, mock } from 'claude-code/testing'

test('/btw @name starts that agent type with the question', async ($, on) => {
  mock.store(on)
  on('session.root', async () => ({ value: '/proj/a' }) as never)
  on('session.id', async () => ({ value: 's-a' }) as never)
  const spawned: unknown[] = []
  on('agent.spawn', async (_t, e) => {
    spawned.push(e)
    return { model: 'sonnet', agentId: 'a1' } as never
  })
  on('agent.list', async () => [] as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.scroll', async () => ({}) as never)
  const r = await $.command.run({ command: 'btw', args: '@Explore what changed?' } as never)
  await new Promise(done => setTimeout(done, 100))
  expect(r).toEqual({})
  expect(spawned.length).toBe(1)
  expect(JSON.stringify(spawned[0])).toContain('"subagent_type":"Explore"')
  expect(JSON.stringify(spawned[0])).toContain('what changed?')
})
