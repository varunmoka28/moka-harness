import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

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

const list = (codex: string) =>
  JSON.stringify({
    result: {
      agents: [
        { pane_id: 'w1:p1', agent: 'claude', agent_status: 'working', terminal_title_stripped: 'Main' },
        { pane_id: 'w2:p1', agent: 'codex', agent_status: codex, name: 'codex_hg047' },
      ],
    },
  })

// Stands for the host: herdr's answer, and what reached the screen.
const host = (on: On, env: Record<string, string>) => {
  const seen = { toasts: [] as string[], commands: [] as string[], held: state(on) }
  const world = { codex: 'working' }
  mock.env(on, env)
  const clock = mock.clock(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => {
    seen.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: list(world.codex),
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })

  return { seen, world, clock }
}

test('shows the other tabs, and toasts when one finishes', async ($, on) => {
  const { seen, world, clock } = host(on, { HERDR_SESSION: 'main', HERDR_PANE_ID: 'w1:p1' })

  await $.session.start(START)
  expect(seen.commands).toEqual(['tabs'])
  expect(seen.held.get('agent-board.tabs')).toBe('tabs: codex_hg047 working')
  expect(seen.toasts).toEqual([])

  world.codex = 'done'
  await clock.advance(30_000)
  expect(seen.held.get('agent-board.tabs')).toBe('tabs: codex_hg047 done')
  expect(seen.toasts).toEqual(['codex_hg047 is done'])

  await clock.advance(30_000)
  expect(seen.toasts).toHaveLength(1)

  const ran = await $.command.run({
    command: 'tabs',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })
  expect(ran.text).toContain('codex_hg047')
  expect(ran.text).not.toContain('Main')
})

test('stays quiet outside herdr', async ($, on) => {
  const { seen } = host(on, {})

  await $.session.start(START)
  expect(seen.commands).toEqual([])
  expect(seen.held.has('agent-board.tabs')).toBe(false)
})

// The same board with a real answer per command: three tabs (Claude, Codex, agy), their sizes, and what was sent.
const rich = (on: On, codexTokens: number, held = new Map<string, unknown>(), compactOn = true) => {
  const world = { codex: 'working', sent: [] as string[][], tokens: codexTokens, ctxAge: 0, gone: false }
  const rows = () => [
    { pane_id: 'w1:p1', agent: 'claude', agent_status: 'working', terminal_title_stripped: 'Main' },
    { pane_id: 'w2:p1', agent: 'codex', agent_status: world.codex, name: 'codex_hg047' },
    { pane_id: 'w3:p1', agent: 'claude', agent_status: 'idle', name: 'review' },
    { pane_id: 'w4:p1', agent: 'agy', agent_status: 'idle', name: 'agy_audit' },
  ]
  const toasts: string[] = []
  mock.env(on, { HERDR_SESSION: 'main', HERDR_PANE_ID: 'w1:p1', ...(compactOn ? { AGENT_BOARD_COMPACT: '1' } : {}) })
  const clock = mock.clock(on)
  state(on, held)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('fs.stat', async (_, e) => {
    if (e.path !== '/tmp/agent-board-ctx/w3_p1.json') throw new Error('no such file')
    return { value: { kind: 'file', size: 1, mtimeMs: (await clock.now()) - world.ctxAge, isLink: false } }
  })
  on('fs.read', (_, e) => {
    if (e.path === '/tmp/agent-board-ctx/w3_p1.json') return { value: JSON.stringify({ agent: 'review', tokens: 212_000, window: 1_000_000 }) }
    throw new Error('no such file')
  })
  on('process.run', (_, e) => {
    const [bin, ...rest] = e.argv
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (bin === 'python3') return out(`${world.tokens} 258400\n`)
    if (rest.includes('pane')) return out(JSON.stringify({ result: { panes: [{ pane_id: 'w2:p1', cwd: '/wt' }] } }))
    if (rest.includes('prompt')) {
      world.sent.push(rest.slice(4))
      return out('{}')
    }
    return out(JSON.stringify({ result: { agents: world.gone ? rows().filter(r => r.pane_id !== 'w2:p1') : rows() } }))
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  return { world, toasts, clock }
}

test('shows each tab context: Claude from its file, Codex from its rollout, agy without one', async ($, on) => {
  const held = new Map<string, unknown>()
  const { world, clock } = rich(on, 90_000, held)
  await $.session.start(START)
  await clock.advance(30_000)
  expect(held.get('agent-board.tabs')).toBe('tabs: codex_hg047 working 90K, review idle 212K, agy_audit idle')
  expect(world.sent).toEqual([])
})

test('an idle Codex tab over 150K gets /compact once after 10 minutes; Claude and agy tabs are left alone', async ($, on) => {
  const { world, toasts, clock } = rich(on, 200_000)
  await $.session.start(START)

  world.codex = 'done'
  await clock.advance(30_000)
  await clock.advance(5 * 60_000)
  expect(world.sent).toEqual([])

  await clock.advance(5 * 60_000 + 30_000)
  expect(world.sent).toEqual([['w2:p1', '/compact']])
  expect(toasts.some(t => t.includes('sent /compact'))).toBe(true)

  await clock.advance(2 * 60_000)
  expect(world.sent).toHaveLength(1)
})

test('working again resets the idle clock, and a small Codex context is never compacted', async ($, on) => {
  const big = rich(on, 200_000)
  await $.session.start(START)
  big.world.codex = 'idle'
  await big.clock.advance(30_000)
  await big.clock.advance(5 * 60_000)
  big.world.codex = 'working'
  await big.clock.advance(30_000)
  big.world.codex = 'idle'
  await big.clock.advance(6 * 60_000)
  expect(big.world.sent).toEqual([])
})

test('a small Codex context is never compacted', async ($, on) => {
  const small = rich(on, 90_000)
  await $.session.start(START)
  small.world.codex = 'idle'
  await small.clock.advance(11 * 60_000)
  expect(small.world.sent).toEqual([])
})

test('a tab is named by its label, so tabs whose agent is called the same can be told apart', async ($, on) => {
  const toasts: string[] = []
  const world = { status: 'working' }
  mock.env(on, { HERDR_SESSION: 'main', HERDR_PANE_ID: 'w1:p1' })
  const clock = mock.clock(on)
  const held = state(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('process.run', (_, e) => {
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv.includes('tab')) {
      return out(JSON.stringify({ result: { tabs: [{ tab_id: 'w2:t1', label: 'fix login bug' }, { tab_id: 'w3:t1', label: '1' }] } }))
    }
    return out(JSON.stringify({ result: { agents: [
      { pane_id: 'w2:p1', tab_id: 'w2:t1', agent: 'claude', agent_status: world.status, name: 'claude' },
      { pane_id: 'w3:p1', tab_id: 'w3:t1', agent: 'claude', agent_status: 'idle', name: 'claude' },
    ] } }))
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  await $.session.start(START)
  expect(held.get('agent-board.tabs')).toBe('tabs: fix login bug working, claude idle')
  world.status = 'done'
  await clock.advance(30_000)
  expect(toasts).toEqual(['fix login bug is done'])
})

// A host whose herdr answer can be swapped (garbage) or held back (gate) after the session starts.
const flaky = (on: On) => {
  const world = { calls: 0, stdout: list('working'), gate: undefined as Promise<void> | undefined, toasts: [] as string[], held: state(on) }
  mock.env(on, { HERDR_SESSION: 'main', HERDR_PANE_ID: 'w1:p1' })
  const clock = mock.clock(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('process.run', async () => {
    world.calls++
    await world.gate
    return { value: { exitCode: 0, stdout: world.stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', (_, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })

  return { world, clock }
}

test('a herdr answer that is not JSON is skipped, not thrown', async ($, on) => {
  const { world, clock } = flaky(on)
  await $.session.start(START)
  world.stdout = 'not json'
  await clock.advance(30_000)
  world.stdout = list('working')
  await clock.advance(30_000)
  expect(world.held.get('agent-board.tabs')).toBe('tabs: codex_hg047 working')
})

test('a poll still running when the next tick fires is not doubled', async ($, on) => {
  const { world, clock } = flaky(on)
  await $.session.start(START)
  world.stdout = list('done')
  let release: () => void = () => undefined
  world.gate = new Promise<void>(resolve => (release = resolve))
  const before = world.calls
  await clock.advance(60_000)
  expect(world.calls - before).toBe(1)
  release()
  await clock.advance(1)
  expect(world.toasts).toEqual(['codex_hg047 is done'])
})

test('a context file older than an hour is ignored', async ($, on) => {
  const held = new Map<string, unknown>()
  const { world, clock } = rich(on, 90_000, held)
  world.ctxAge = 61 * 60_000
  await $.session.start(START)
  await clock.advance(30_000)
  expect(held.get('agent-board.tabs')).toBe('tabs: codex_hg047 working 90K, review idle, agy_audit idle')
})

test('a closed pane is forgotten, so a new tab in its place is not treated as already compacted', async ($, on) => {
  const { world, clock } = rich(on, 200_000)
  await $.session.start(START)
  world.codex = 'idle'
  await clock.advance(30_000)
  await clock.advance(10 * 60_000)
  expect(world.sent).toHaveLength(1)

  world.gone = true
  await clock.advance(30_000)
  world.gone = false
  world.codex = 'idle'
  await clock.advance(30_000)
  await clock.advance(10 * 60_000)
  expect(world.sent).toHaveLength(2)
})

test('nothing is sent to an idle Codex tab unless AGENT_BOARD_COMPACT=1', async ($, on) => {
  const { world, clock } = rich(on, 200_000, new Map<string, unknown>(), false)
  await $.session.start(START)
  world.codex = 'idle'
  await clock.advance(30_000)
  await clock.advance(11 * 60_000)
  expect(world.sent).toEqual([])
})

test('/tabs says herdr did not answer when herdr cannot be run or prints nonsense', async ($, on) => {
  const { world, clock } = flaky(on)
  await $.session.start(START)
  world.stdout = 'not json'
  const run = () =>
    $.command.run({ command: 'tabs', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect((await run()).text).toBe('herdr did not answer.')
  void clock
})

test('the session still starts when the board cannot start', async ($, on) => {
  mock.env(on, { HERDR_SESSION: 'main', HERDR_PANE_ID: 'w1:p1' })
  mock.clock(on)
  state(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => {
    throw new Error('refused')
  })
  await expect($.session.start(START)).resolves.toBeDefined()
})
