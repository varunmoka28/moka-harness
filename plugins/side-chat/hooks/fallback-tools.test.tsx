import { test, expect, mock } from 'claude-code/testing'

const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const settle = () => new Promise(done => setTimeout(done, 100))

// The fork never answers, so haiku gets the transcript text; returns the prompt haiku was sent.
async function haikuPrompt($: any, on: any, rows: unknown[]) {
  mock.store(on)
  on('session.root', async () => ({ value: '/proj/a' }) as never)
  on('session.id', async () => ({ value: 's-a' }) as never)
  on('agent.list', async () => ({ value: [] }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.scroll', async () => ({}) as never)
  on('model.fork', async () => ({ value: { isAnswered: false, reason: 'nothing-to-fork' } }) as never)
  on('session.messages', async () => ({ value: rows }) as never)
  let prompt = ''
  on('model.complete', async (_t: any, e: any) => {
    prompt = e.prompt
    return { value: { isAnswered: true, text: 'ok', usage } } as never
  })
  await $.command.run({ command: 'btw', args: 'q' } as never)
  await settle()
  return prompt
}

const use = (tool: string, id: string, extra: object = {}) => ({ tool_use_id: id, tool, input: {}, ...extra })

test('the fallback prompt lists the tool names of the last turns and no tool result text', async ($, on) => {
  const prompt = await haikuPrompt($, on, [
    { role: 'user', text: 'fix the parser', toolUses: [] },
    { role: 'assistant', text: '', toolUses: [use('Read', 't1', { input: { file_path: '/secret/path.ts' }, text: 'RESULT-SENTINEL-1', result: 'RESULT-SENTINEL-1' })] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 't1', text: 'RESULT-SENTINEL-2', isError: false }] },
    {
      role: 'assistant',
      text: 'Parser fixed',
      toolUses: [use('Edit', 't2', { text: 'RESULT-SENTINEL-3' }), use('Read', 't3', { text: 'RESULT-SENTINEL-3' }), use('Read', 't4', { text: 'RESULT-SENTINEL-3' })],
    },
  ])
  expect(prompt).toContain('assistant: [tools: Read]')
  expect(prompt).toContain('assistant: Parser fixed [tools: Edit, Read]')
  expect(prompt).toContain('user: fix the parser')
  expect(prompt).not.toContain('RESULT-SENTINEL')
  expect(prompt).not.toContain('/secret/path.ts')
  expect(prompt).not.toContain('tools: ]')
})

test('the tool-name context keeps the existing size cap', async ($, on) => {
  const prompt = await haikuPrompt($, on, [
    { role: 'user', text: 'OLDEST-' + 'x'.repeat(70000), toolUses: [] },
    { role: 'assistant', text: 'done', toolUses: [use('Grep', 't1')] },
  ])
  expect(prompt).toContain('[tools: Grep]')
  expect(prompt).not.toContain('OLDEST-')
})
