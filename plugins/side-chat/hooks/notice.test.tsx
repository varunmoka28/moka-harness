import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const
const RAN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const
const PANE = {
  plugin: 'side-chat',
  component: 'Pane',
  requestId: 'side-chat',
  surface: 'terminal',
  props: { title: 'Side chat', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

// Stands for the host: session state and the store.
const host = (on: On, preset: Record<string, unknown> = {}) => {
  const held = new Map<string, { value: unknown; version: number }>(Object.entries(preset).map(([k, value]) => [k, { value, version: 1 }]))
  const clock = { advance: (ms: number) => new Promise(done => setTimeout(done, ms + 20)) }
  mock.store(on)
  on('state.get', (_, e) => ({ value: held.get(`${e.plugin}.${e.key}`) ?? { value: undefined, version: 0 } }))
  on('state.set', (_, e) => {
    const version = (held.get(`${e.plugin}.${e.key}`)?.version ?? 0) + 1
    held.set(`${e.plugin}.${e.key}`, { value: e.value, version })
    return { value: { isSet: true, version } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.scroll', () => ({ value: undefined }) as never)
  const value = (key: string) => held.get(`side-chat.${key}`)?.value
  return { clock, value }
}

test('/model typed in the pane is a notice, not a saved turn', async ($, on) => {
  const { clock, value } = host(on)
  await $.session.start(START)
  const ui = await $.ui.mount(PANE)
  await ui.input({ key: 'side-input', text: '/model sonnet' })
  await clock.advance(10)
  expect(value('model')).toBe('sonnet')
  expect(value('turns') ?? []).toEqual([])
  await ui.unmount()
})

test('a new thread folds every answer again', async ($, on) => {
  const { value } = host(on, { 'side-chat.opened': [0, 2] })
  await $.session.start(START)
  await $.command.run({ command: 'side', args: 'new', ...RAN })
  expect(value('opened')).toEqual([])
})

test('a flashed notice clears after three seconds on the engine clock', async ($, on) => {
  const { value } = host(on)
  const clock = mock.clock(on)
  await $.session.start(START)
  await $.command.run({ command: 'side', args: 'model sonnet', ...RAN })
  expect(value('notice')).not.toBe('')
  await clock.advance(3000)
  expect(value('notice')).toBe('')
})
