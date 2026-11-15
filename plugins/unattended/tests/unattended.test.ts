import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const QUESTION = {
  tool: 'AskUserQuestion',
  questions: [{ question: 'Which?', header: 'Pick', multiSelect: false, options: [{ label: 'a', description: 'a' }, { label: 'b', description: 'b' }] }],
} as const

const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const

// Stands for the host's session state: a map the plugin reads and writes through.
const state = (on: On, held = new Map<string, unknown>()) => {
  on('state.get', (_, e) => ({ value: { value: held.get(`${e.plugin}.${e.key}`), version: 1 } }))
  on('state.set', (_, e) => {
    held.set(`${e.plugin}.${e.key}`, e.value)
    return { value: { isSet: true, version: 1 } }
  })

  return held
}

// Stands for the engine beneath the plugin: answers every tool call.
const host = (on: On, env: Record<string, string> = {}) => {
  const seen = { calls: [] as string[], held: state(on) }
  on('tool.call', (_, e) => {
    seen.calls.push(e.tool)
    return { result: { ok: true } as never }
  })
  mock.env(on, env)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))

  return seen
}

test('questions pass until /unattended, then are refused with the carry-on note', async ($, on) => {
  const seen = host(on)
  await $.session.start(START)
  const run = (args: string) =>
    $.command.run({
      command: 'unattended',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 120 },
    })

  await $.tool.call(QUESTION)
  expect(seen.calls).toEqual(['AskUserQuestion'])

  expect((await run('')).text).toContain('on')
  expect(seen.held.get('unattended.on')).toBe(true)

  const refused = await $.tool.call(QUESTION)
  expect(refused.deny).toContain('nobody is at the keyboard')
  const plan = await $.tool.call({ tool: 'EnterPlanMode' })
  expect(plan.deny).toContain('plan mode')
  expect(seen.calls).toEqual(['AskUserQuestion'])

  // Other tools are untouched.
  await $.tool.call({ tool: 'Read', file_path: '/x' })
  expect(seen.calls.at(-1)).toBe('Read')

  expect((await run('off')).text).toBe('Unattended mode off.')
  expect(seen.held.get('unattended.on')).toBe(false)
  await $.tool.call(QUESTION)
  expect(seen.calls.at(-1)).toBe('AskUserQuestion')
})

test('CLAUDE_UNATTENDED=1 at launch switches it on', async ($, on) => {
  const seen = host(on, { CLAUDE_UNATTENDED: '1' })
  await $.session.start(START)

  expect(seen.held.get('unattended.on')).toBe(true)
  expect((await $.tool.call(QUESTION)).deny).toContain('Do not ask again')
})

test('a failing state read lets the question through instead of blocking the tool call', async ($, on) => {
  const calls: string[] = []
  on('state.get', () => {
    throw new Error('state unavailable')
  })
  on('tool.call', (_, e) => {
    calls.push(e.tool)
    return { result: { ok: true } as never }
  })

  await $.tool.call(QUESTION)
  await $.tool.call({ tool: 'EnterPlanMode' })
  expect(calls).toEqual(['AskUserQuestion', 'EnterPlanMode'])
})

test('unknown arguments leave the mode alone and show usage', async ($, on) => {
  const seen = host(on)
  await $.session.start(START)
  const run = (args: string) =>
    $.command.run({ command: 'unattended', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })

  await run('on')
  const bad = await run('off extra')
  expect(bad.text).toContain('Usage')
  expect(seen.held.get('unattended.on')).toBe(true)

  await run('off')
  expect((await run('on extra')).text).toContain('Usage')
  expect(seen.held.get('unattended.on')).toBe(false)
})
