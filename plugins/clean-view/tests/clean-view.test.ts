import { expect, test } from 'claude-code/testing'

import { cleanName } from '../hooks/clean-view'

const PLAN = 'mcp__clean-view__plan_steps'
const REPORT = 'mcp__clean-view__report_progress'

function engine(on: any) {
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', ($: any, e: any) => ({ value: { tool: `mcp__clean-view__${e.name}` } }))
  on('model.complete', () => ({ value: { isAnswered: true, text: 'Build the landing page', usage: undefined } }))
  on('ui.toast', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 0 }))
  on('clock.every', () => ({ value: {} }))
  on('tool.call', () => ({ result: 'ran' }))
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
}

async function start($: any, text: string) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' } as any)
  await $.turn.start({ text, turnId: 't1' } as any)
}

test('a long name with a path and a code file cleans to plain words', () => {
  expect(cleanName('Build the pricing section in `src/Pricing.tsx`')).toBe('Build the pricing section in')
  const long = cleanName('Rewrite every single page of the marketing site so that the new brand voice reads well everywhere')
  expect(long.length).toBeLessThanOrEqual(40)
  expect(long.endsWith('…')).toBe(true)
  expect(cleanName('`src/Pricing.tsx`')).toBe('Working on it')
})

test('every other tool is denied until plan_steps, then allowed', async ($, on) => {
  engine(on)
  await start($, 'Build my landing page')

  const denied = await $.tool.call({ tool: 'Bash', input: { command: 'ls' } } as any)
  expect(denied.deny).toContain('plan_steps')

  const planned = await $.tool.call({
    tool: PLAN,
    input: { steps: ['Read your brand notes', 'Build the pricing section'] },
  } as any)
  expect(planned.result).toBe('Planned 2 steps. The first one has started.')

  const allowed = await $.tool.call({ tool: 'Bash', input: { command: 'ls' } } as any)
  expect(allowed.deny).toBeUndefined()
})

test('report_progress at 100 checks off the first step and starts the second', async ($, on) => {
  engine(on)
  await start($, 'Build my landing page')
  await $.tool.call({ tool: PLAN, input: { steps: ['Read your brand notes', 'Build the pricing section'] } } as any)

  const first = await $.tool.call({ tool: REPORT, input: { task: 'Read your brand notes', percent: 100 } } as any)
  expect(first.result).toBe('Recorded 100% on "Read your brand notes".')

  const second = await $.tool.call({ tool: REPORT, input: { task: 'Build the pricing section', percent: 60 } } as any)
  expect(second.result).toBe('Recorded 60% on "Build the pricing section".')
})

test('/simple off and on flips the setting and says so', async ($, on) => {
  engine(on)
  await start($, 'Build my landing page')

  expect((await $.command.run({ command: 'simple', args: 'off' } as any)).text).toBe('Clean View is off.')
  expect((await $.command.run({ command: 'simple', args: '' } as any)).text).toBe('Clean View is on.')
})
