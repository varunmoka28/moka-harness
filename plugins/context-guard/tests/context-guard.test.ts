import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const TURN = { answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const
const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const

// Stands for the host: the live context size, and what reached the screen.
const host = (on: On) => {
  const toasts: string[] = []
  const ctx = { tokens: 0 as number | undefined }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: 'done' }))
  on('session.usage', () => ({
    value: { startedAt: 0, rateLimits: [], context: { tokens: ctx.tokens, window: 1_000_000 } },
  }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  return { toasts, ctx }
}

type Engine = Parameters<Parameters<typeof test>[1]>[0]
const turn = ($: Engine, extra: Record<string, unknown> = {}) => $.turn.complete({ ...TURN, ...extra })

test('stays quiet under 150K, warns once on crossing, again each 100K', async ($, on) => {
  const seen = host(on)
  await $.session.start(START)

  seen.ctx.tokens = 149_000
  await turn($)
  expect(seen.toasts).toEqual([])

  seen.ctx.tokens = 152_000
  await turn($)
  await turn($)
  expect(seen.toasts).toHaveLength(1)
  expect(seen.toasts[0]).toBe('Context is 152K tokens. Every turn re-sends it: /park, then /clear, or /compact, before the next task.')

  seen.ctx.tokens = 260_000
  await turn($)
  expect(seen.toasts).toHaveLength(2)
})

test('a compaction re-arms the warning', async ($, on) => {
  const seen = host(on)
  await $.session.start(START)

  seen.ctx.tokens = 200_000
  await turn($)
  seen.ctx.tokens = 30_000
  await turn($)
  seen.ctx.tokens = 160_000
  await turn($)
  expect(seen.toasts).toHaveLength(2)
})

test('a subagent turn, an aborted turn and an unknown size say nothing', async ($, on) => {
  const seen = host(on)
  await $.session.start(START)

  seen.ctx.tokens = 300_000
  await turn($, { agentId: 'a1' })
  await turn($, { isAborted: true })
  seen.ctx.tokens = undefined
  await turn($)
  expect(seen.toasts).toEqual([])
})

import { mock } from 'claude-code/testing'

// A tab with auto-compact switched on: the env, the clock and compaction.
const compactHost = (on: On, env: Record<string, string>, failCompact = false) => {
  const seen = { toasts: [] as string[], compacts: 0 }
  const ctx = { tokens: 0 }
  mock.env(on, env)
  const clock = mock.clock(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: 'done' }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { tokens: ctx.tokens, window: 1_000_000 } } }))
  on('session.compact', () => {
    if (failCompact) throw new Error('boom')
    seen.compacts++
    return { messages: [{ role: 'user', text: 'summary', toolUses: [] }] } as never
  })
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })

  return { seen, ctx, clock }
}

const ON = { CONTEXT_GUARD_AUTO_COMPACT: '1' }

test('with auto-compact on, a tab over 150K that sits idle 10 minutes compacts itself', async ($, on) => {
  const { seen, ctx, clock } = compactHost(on, ON)
  await $.session.start(START)

  ctx.tokens = 212_000
  await turn($)
  await clock.advance(9 * 60_000)
  expect(seen.compacts).toBe(0)
  await clock.advance(60_000)
  expect(seen.compacts).toBe(1)
  expect(seen.toasts.some(t => t.includes('Compacted from 212K'))).toBe(true)
})

test('auto-compact is off unless switched on', async ($, on) => {
  const { seen, ctx, clock } = compactHost(on, {})
  await $.session.start(START)
  ctx.tokens = 300_000
  await turn($)
  await clock.advance(60 * 60_000)
  expect(seen.compacts).toBe(0)
})

test('new work cancels the idle compaction', async ($, on) => {
  const { seen, ctx, clock } = compactHost(on, ON)
  await $.session.start(START)

  ctx.tokens = 212_000
  await turn($)
  await clock.advance(5 * 60_000)
  await $.prompt.submit({ text: 'next task' })
  await clock.advance(20 * 60_000)
  expect(seen.compacts).toBe(0)
})

test('two turn completions in a row leave one timer, not two', async ($, on) => {
  const { seen, ctx, clock } = compactHost(on, ON)
  await $.session.start(START)
  ctx.tokens = 212_000
  await turn($)
  await clock.advance(5 * 60_000)
  await turn($)
  await clock.advance(60 * 60_000)
  expect(seen.compacts).toBe(1)
})

test('a small context does not arm', async ($, on) => {
  const { seen, ctx, clock } = compactHost(on, ON)
  await $.session.start(START)
  ctx.tokens = 90_000
  await turn($)
  await clock.advance(60 * 60_000)
  expect(seen.compacts).toBe(0)
})

test('a headless run never warns or arms', async ($, on) => {
  const { seen, ctx, clock } = compactHost(on, ON)
  await $.session.start({ ...START, isInteractive: false })
  ctx.tokens = 212_000
  await turn($)
  await clock.advance(60 * 60_000)
  expect(seen.compacts).toBe(0)
  expect(seen.toasts).toEqual([])
})

test('a plugin reload mid-session re-arms a tab that is already over 150K', async ($, on) => {
  const { seen, ctx, clock } = compactHost(on, ON)
  ctx.tokens = 259_000
  await $.session.start(START)
  await clock.advance(9 * 60_000)
  expect(seen.compacts).toBe(0)
  await clock.advance(60_000)
  expect(seen.compacts).toBe(1)
})

test('a failing context read never blocks the turn', async ($, on) => {
  mock.env(on, ON)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: 'done' }))
  on('session.usage', () => {
    throw new Error('boom')
  })
  await $.session.start(START)
  await turn($)
})

test('a failing compaction does not crash', async ($, on) => {
  const { seen, ctx, clock } = compactHost(on, ON, true)
  await $.session.start(START)
  ctx.tokens = 212_000
  await turn($)
  await clock.advance(10 * 60_000)
  expect(seen.compacts).toBe(0)
})

test('exactly 150K warns, naming /park as the next step', async ($, on) => {
  const seen = host(on)
  await $.session.start(START)
  seen.ctx.tokens = 150_000
  await turn($)
  expect(seen.toasts).toEqual(['Context is 150K tokens. Every turn re-sends it: /park, then /clear, or /compact, before the next task.'])
})
