import { expect, mock, test } from 'claude-code/testing'

test('the bar adds up tokens read and written from each request', async ($, on) => {
  mock.clock(on)
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => $.ui.resolve(e).Box({}) as any) // the engine's own band, beneath
  on('turn.step', async function* ($, e) {
    yield { kind: 'text', index: 0, text: 'ok' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0, model: 'claude-test' } }
  })
  for (const index of [0, 1]) {
    const stream = $.turn.step({ turnId: 't', index, model: 'claude-test', messageCount: 1 })
    let step = await stream.next()
    while (step.done !== true) step = await stream.next()
  }

  const bar = await $.ui.mount({ plugin: 'terminal-desk', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 200, scroll: { offset: 0, bodyRows: 10 }, view: {} } } as any)
  expect(await bar.find({ text: /8\.0K read · 4\.0K written/ })).toBeDefined()
  expect(await bar.find({ text: /context/ })).toBeDefined()
})

test('the bar keeps the band rows of mods drawn after it, above the bar', async ($, on) => {
  mock.clock(on)
  // stands in for a band mod beneath terminal-desk, such as next-steps' suggestions
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: 'next: run the tests' }) as any
  })
  const bar = await $.ui.mount({ plugin: 'terminal-desk', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 200, scroll: { offset: 0, bodyRows: 10 }, view: {} } } as any)
  expect(await bar.find({ text: /next: run the tests/ })).toBeDefined()
  expect(await bar.find({ text: /context/ })).toBeDefined()
})
