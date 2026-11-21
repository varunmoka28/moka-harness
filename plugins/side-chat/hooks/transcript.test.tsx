import { test, expect, mock } from 'claude-code/testing'

const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const settle = () => new Promise(done => setTimeout(done, 100))
const mount = ($: any) => $.ui.mount({ plugin: 'side-chat', surface: 'terminal', component: 'Pane', props: {}, requestId: 'side-chat' } as never)

const row = (role: string, text: string, toolUses: unknown[] = []) => ({ role, text, toolUses })
const agents = [
  { id: 'a1', name: 'scout', type: 'Explore', status: 'running', description: 'd' },
  { id: 'a2', type: 'Explore', status: 'running', description: 'd' },
  { id: 'a3', type: 'scout', status: 'running', description: 'd' },
]

// A session whose agents answer session.messages by agentId; returns what the mod read, sent and called.
function host(on: any, rows: Record<string, unknown>) {
  const seen = { read: [] as unknown[], prompts: [] as string[], models: [] as string[], forks: 0, spawns: 0 }
  mock.store(on)
  on('session.root', async () => ({ value: '/proj/a' }) as never)
  on('session.id', async () => ({ value: 's-a' }) as never)
  on('agent.list', async () => ({ value: agents }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.scroll', async () => ({}) as never)
  on('ui.toast', async () => ({ value: undefined }) as never)
  on('session.messages', async (_t: any, e: any) => {
    seen.read.push(e.agentId)
    return { value: rows[e.agentId] } as never
  })
  on('model.complete', async (_t: any, e: any) => {
    seen.prompts.push(e.prompt)
    seen.models.push(e.model)
    return { value: { isAnswered: true, text: 'It is parsing.', usage } } as never
  })
  on('model.fork', async () => {
    seen.forks++
    return { value: { isAnswered: false, reason: 'nothing-to-fork' } } as never
  })
  on('agent.spawn', async () => {
    seen.spawns++
    return { model: 'haiku', agentId: 'x' } as never
  })
  return seen
}

const ask = async ($: any, args: string) => {
  await $.command.run({ command: 'btw', args } as never)
  await settle()
}

test('^scout answers from that agent\'s rows and tool uses, as the last line asks, without fork or spawn', async ($, on) => {
  const seen = host(on, {
    a1: [row('user', 'fix the parser'), row('assistant', 'Reading it now', [{ tool: 'Read', input: { file_path: 'parser.ts' }, text: 'export const PARSER_MARKER = 1' }])],
    a2: [row('user', 'WRONG AGENT')],
  })
  await ask($, '^scout what is it doing?')
  expect(seen.read).toEqual(['a1'])
  expect(seen.prompts).toHaveLength(1)
  expect(seen.prompts[0]).toContain('user: fix the parser')
  expect(seen.prompts[0]).toContain('PARSER_MARKER')
  expect(seen.prompts[0]).not.toContain('WRONG AGENT')
  expect(seen.prompts[0].endsWith('Question: what is it doing?')).toBe(true)
  expect(seen.models).toEqual(['haiku'])
  expect(seen.forks + seen.spawns).toBe(0)
  const m = await mount($)
  expect((await m.find({ key: 'answer-last' }))?.text).toContain('It is parsing.')
  expect(await m.find({ type: 'Text', text: /^transcript$/ })).toBeDefined()
  expect(await m.find({ type: 'Text', text: /^scout transcript · / })).toBeDefined()
})

test('the name picks the agent: name, then type, then exact id, the newest first, case ignored except for ids', async ($, on) => {
  const seen = host(on, { a1: [row('user', 'one')], a2: [row('user', 'two')], a3: [row('user', 'three')] })
  await ask($, '^explore q')
  await ask($, '^SCOUT q')
  await ask($, '^a2 q')
  await ask($, '^A1 q')
  // explore: a2 is the newest of that type; SCOUT: a1 is named so, though a3 (newer) has that type; a2: by id; A1: no match.
  expect(seen.read).toEqual(['a2', 'a1', 'a2'])
  expect(seen.prompts).toHaveLength(3)
  expect((await (await mount($)).find({ key: 'answer-last' }))?.text).toContain('No agent called A1')
})

test('an unknown name is answered in the pane without asking a model', async ($, on) => {
  const seen = host(on, {})
  await ask($, '^ghost what now?')
  expect((await (await mount($)).find({ key: 'answer-last' }))?.text).toContain('No agent called ghost')
  expect(seen.read).toEqual([])
  expect(seen.prompts).toEqual([])
})

test('a transcript the session will not read is answered with the reason, without asking a model', async ($, on) => {
  const seen = host(on, { a1: { deny: 'finished' } })
  await ask($, '^scout what happened?')
  expect((await (await mount($)).find({ key: 'answer-last' }))?.text).toContain('Cannot read scout: finished')
  expect(seen.read).toEqual(['a1'])
  expect(seen.prompts).toEqual([])
})
