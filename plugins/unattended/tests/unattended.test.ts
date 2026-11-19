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
  const seen = { calls: [] as string[], held: state(on), files: new Map<string, string>() }
  on('fs.read', (_, e) => {
    const text = seen.files.get(e.path)
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.exists', (_, e) => ({ value: seen.files.has(e.path) || e.path.startsWith('/locked/') }))
  on('fs.write', (_, e) => {
    if (e.path.startsWith('/missing/')) throw new Error('ENOENT')
    seen.files.set(e.path, e.text)
    return { value: undefined }
  })
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

const run = ($: Parameters<Parameters<typeof test>[1]>[0], args: string) =>
  $.command.run({ command: 'unattended', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })

test('route mode writes the question to the task file as STATUS: blocked and tells Claude to carry on', async ($, on) => {
  const seen = host(on, { CLAUDE_UNATTENDED: 'route', CLAUDE_TASK_FILE: '/w/task.md' })
  seen.files.set('/w/task.md', '# Task\nDo the thing.\n')
  await $.session.start(START)
  expect(seen.held.get('unattended.on')).toBe(true)
  expect(seen.held.get('unattended.route')).toBe(true)

  const refused = await $.tool.call(QUESTION)
  expect(seen.calls).toEqual([])
  expect(seen.files.get('/w/task.md')).toBe('# Task\nDo the thing.\n\nSTATUS: blocked\nQUESTION: Which? Options: a | b\n')
  expect(refused.deny).toContain('/w/task.md')
  expect(refused.deny).toContain('does not depend on the answer')

  // A second question adds a second blocked line, so the watcher wakes again.
  await $.tool.call(QUESTION)
  expect(seen.files.get('/w/task.md')!.match(/STATUS: blocked/g)).toHaveLength(2)

  // Plan mode is still refused, not routed.
  expect((await $.tool.call({ tool: 'EnterPlanMode' })).deny).toContain('plan mode')
})

test('route mode without CLAUDE_TASK_FILE falls back to picking and says why', async ($, on) => {
  const seen = host(on)
  await $.session.start(START)
  expect((await run($, 'route')).text).toContain('CLAUDE_TASK_FILE is not set')

  const refused = await $.tool.call(QUESTION)
  expect(refused.deny).toContain('Pick the most sensible option yourself')
  expect(refused.deny).toContain('CLAUDE_TASK_FILE is not set')
  expect(seen.files.size).toBe(0)
})

test('route mode with a task file that cannot be written falls back to picking', async ($, on) => {
  const seen = host(on, { CLAUDE_UNATTENDED: 'route', CLAUDE_TASK_FILE: '/missing/task.md' })
  await $.session.start(START)

  const refused = await $.tool.call(QUESTION)
  expect(refused.deny).toContain('Pick the most sensible option yourself')
  expect(refused.deny).toContain('/missing/task.md')
  expect(seen.calls).toEqual([])
})

test('route mode leaves a task file it cannot read untouched and falls back to picking', async ($, on) => {
  const seen = host(on, { CLAUDE_UNATTENDED: 'route', CLAUDE_TASK_FILE: '/locked/task.md' })
  await $.session.start(START)

  const refused = await $.tool.call(QUESTION)
  expect(refused.deny).toContain('Pick the most sensible option yourself')
  expect(seen.files.size).toBe(0)
})

test('route mode creates the task file when it does not exist yet', async ($, on) => {
  const seen = host(on, { CLAUDE_UNATTENDED: 'route', CLAUDE_TASK_FILE: '/w/new.md' })
  await $.session.start(START)

  await $.tool.call(QUESTION)
  expect(seen.files.get('/w/new.md')).toBe('STATUS: blocked\nQUESTION: Which? Options: a | b\n')
})

test('/unattended flips route mode off', async ($, on) => {
  const seen = host(on, { CLAUDE_TASK_FILE: '/w/task.md' })
  await $.session.start(START)
  expect((await run($, 'route')).text).toContain('route')
  expect(seen.held.get('unattended.on')).toBe(true)
  expect(seen.held.get('unattended.route')).toBe(true)
  expect((await run($, '')).text).toBe('Unattended mode off.')
  expect(seen.held.get('unattended.on')).toBe(false)
  expect(seen.held.get('unattended.route')).toBe(false)

  // Flipping back on gives plain on mode, not route.
  await run($, '')
  expect(seen.held.get('unattended.route')).toBe(false)
  expect((await $.tool.call(QUESTION)).deny).toContain('Pick the most sensible option yourself')
})
