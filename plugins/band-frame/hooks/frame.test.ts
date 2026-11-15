import { expect, test } from 'claude-code/testing'

const props = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 40, scroll: { offset: 0, bodyRows: 10 }, view: {} }
const mount = ($: any) => $.ui.mount({ plugin: 'band-frame', surface: 'terminal', component: 'AbovePrompt', props })

test('wraps the band beneath in a top rule and background', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, async ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, null, 'Enhance')
  })
  on('session.start', async (_$: any, e: any) => ({ cwd: e.cwd }))
  await $.session.start({ source: 'startup', cwd: '/repo' } as any)
  const drawn = JSON.stringify(await (await mount($)).drawn())
  expect(drawn).toContain('─'.repeat(40))
  expect(drawn).toContain('Enhance')
  expect(drawn).toContain('#3a342b')
})

