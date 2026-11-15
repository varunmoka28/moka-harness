import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// Stands for the host's session state: a map the plugin reads and writes through.
const state = (on: On, held = new Map<string, unknown>()) => {
  on('state.get', (_, e) => ({ value: { value: held.get(`${e.plugin}.${e.key}`), version: 1 } }))
  on('state.set', (_, e) => {
    held.set(`${e.plugin}.${e.key}`, e.value)
    return { value: { isSet: true, version: 1 } }
  })

  return held
}

const BAND = {
  plugin: 'cache-clock',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const TURN = {
  answer: 'done',
  durationMs: 1000,
  isAborted: false,
  turnId: 't1',
  reason: 'answer',
  usage: { model: 'm', input_tokens: 2, output_tokens: 1, cache_read_input_tokens: 98, cache_creation_input_tokens: 0 },
} as const

const MINUTES = { text: /^(cheap for \d+ min|full price)$/ }
// The first Text of squares is the filled part; the bar's Box holds all of them
const FILLED = { type: 'Text', text: /^■+$/ } as const

test('the bar drains from the last main turn and goes cold after an hour', async ($, on) => {
  mock.env(on, {})
  const clock = mock.clock(on, { now: 1_000_000 })
  on('turn.complete', () => ({ text: 'done' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 160_000, window: 1_000_000 }, rateLimits: [] } }))
  // Stands for the engine, which draws nothing of its own in the band
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: '' }))

  // Nothing to show before the first turn
  let band = await $.ui.mount(BAND)
  expect(await band.find(MINUTES)).toBeUndefined()
  await band.unmount()

  await $.turn.complete(TURN)

  band = await $.ui.mount(BAND)
  expect((await band.find(MINUTES))?.text).toBe('cheap for 60 min')
  expect((await band.find(FILLED))?.text).toBe('■'.repeat(20))
  expect((await band.find({ text: /^last reply/ }))?.text).toBe('last reply 98% cheap')
  await band.unmount()

  await clock.advance(17 * 60_000)
  band = await $.ui.mount(BAND)
  expect((await band.find(MINUTES))?.text).toBe('cheap for 43 min')
  expect((await band.find(FILLED))?.text).toBe('■'.repeat(14))
  await band.unmount()

  await clock.advance(43 * 60_000)
  band = await $.ui.mount(BAND)
  expect((await band.find(MINUTES))?.text).toBe('full price')
  expect((await band.find({ text: /^next message/ }))?.text).toBe('next message re-sends 160k')
  await band.unmount()
})

test('a subagent turn does not restart the clock, and a running turn hides it', async ($, on) => {
  mock.env(on, {})
  mock.clock(on, { now: 1_000_000 })
  on('turn.complete', () => ({ text: 'done' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 160_000, window: 1_000_000 }, rateLimits: [] } }))
  // Stands for the engine, which draws nothing of its own in the band
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: '' }))

  await $.turn.complete({ ...TURN, agentId: 'sub-1' })
  let band = await $.ui.mount(BAND)
  expect(await band.find(MINUTES)).toBeUndefined()
  await band.unmount()

  await $.turn.complete(TURN)
  band = await $.ui.mount(BAND)
  expect((await band.find(MINUTES))?.text).toBe('cheap for 60 min')
  await band.unmount()

  band = await $.ui.mount({ ...BAND, props: { ...BAND.props, isWorking: true } })
  expect(await band.find(MINUTES)).toBeUndefined()
  await band.unmount()
})

test('the other mods state shows as one green line, with or without the clock', async ($, on) => {
  const held = state(on)
  mock.env(on, {})
  mock.clock(on, { now: 1_000_000 })
  on('turn.complete', () => ({ text: 'done' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 160_000, window: 1_000_000 }, rateLimits: [] } }))
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: '' }))

  let band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /^unattended/ })).toBeUndefined()
  await band.unmount()

  held.set('unattended.on', true)
  held.set('layman.asks', 2)

  // Before the first turn there is no clock, only the line
  band = await $.ui.mount(BAND)
  expect(await band.find(MINUTES)).toBeUndefined()
  expect((await band.find({ type: 'Text', text: /^unattended/ }))?.text).toBe('unattended on · plain mode')
  await band.unmount()

  await $.turn.complete(TURN)
  band = await $.ui.mount(BAND)
  expect((await band.find(MINUTES))?.text).toBe('cheap for 60 min')
  expect((await band.find({ type: 'Text', text: /^unattended/ }))?.text).toBe('unattended on · plain mode')
  await band.unmount()

})

test('one toast per window when the cache has 5 minutes left, and a new turn re-arms it', async ($, on) => {
  const toasts: string[] = []
  state(on)
  mock.env(on, { CACHE_CLOCK_TTL_MINUTES: '10' })
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('turn.complete', () => ({ text: 'done' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 160_000, window: 1_000_000 }, rateLimits: [] } }))
  on('ui.invalidate', () => ({ value: undefined }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete(TURN)

  await clock.advance(4 * 60_000)
  expect(toasts).toEqual([])

  await clock.advance(2 * 60_000)
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('cache goes cold in')

  await clock.advance(2 * 60_000)
  expect(toasts).toHaveLength(1)

  await $.turn.complete(TURN)
  await clock.advance(6 * 60_000)
  expect(toasts).toHaveLength(2)
})

test('no cold toast while a turn is running, and CACHE_CLOCK_TTL_MINUTES moves the window', async ($, on) => {
  const toasts: string[] = []
  state(on)
  mock.env(on, { CACHE_CLOCK_TTL_MINUTES: '8' })
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'done' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 160_000, window: 1_000_000 }, rateLimits: [] } }))
  on('ui.invalidate', () => ({ value: undefined }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete(TURN)

  // A long turn starts; the previous turn's window runs low but the cache is being refreshed
  await $.turn.start({ turnId: 't2', text: 'long job' })
  await clock.advance(4 * 60_000)
  expect(toasts).toEqual([])

  // After it ends the window restarts; with an 8 minute TTL the toast comes 3 minutes in
  await $.turn.complete(TURN)
  await clock.advance(2 * 60_000)
  expect(toasts).toEqual([])
  await clock.advance(60_000)
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('cache goes cold in 5 min')
})

test('a subagent finishing during a running turn does not end the running state', async ($, on) => {
  const toasts: string[] = []
  state(on)
  mock.env(on, { CACHE_CLOCK_TTL_MINUTES: '8' })
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'done' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 160_000, window: 1_000_000 }, rateLimits: [] } }))
  on('ui.invalidate', () => ({ value: undefined }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete(TURN)

  await $.turn.start({ turnId: 't2', text: 'long job' })
  await $.turn.complete({ ...TURN, agentId: 'sub-1' })
  await clock.advance(4 * 60_000)
  expect(toasts).toEqual([])
})

test('a zero, negative or non-numeric CACHE_CLOCK_TTL_MINUTES falls back to 60', async ($, on) => {
  mock.env(on, { CACHE_CLOCK_TTL_MINUTES: '-5' })
  mock.clock(on, { now: 1_000_000 })
  on('turn.complete', () => ({ text: 'done' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 160_000, window: 1_000_000 }, rateLimits: [] } }))
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: '' }))

  await $.turn.complete(TURN)
  const band = await $.ui.mount(BAND)
  expect((await band.find(MINUTES))?.text).toBe('cheap for 60 min')
  await band.unmount()
})
