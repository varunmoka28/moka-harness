import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Ledger } from '../types'

type Engine = Parameters<TestBody>[0]

const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const
const RAN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 200 } } as const
const PANE = {
  plugin: 'run-ledger',
  component: 'Pane',
  requestId: 'run-ledger',
  props: { title: 'Run ledger', isFocused: false, bodyColumns: 200, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const IDS: Record<string, string> = { haiku: 'claude-haiku-4-5-20251001', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' }
// On claude-fable-5-1: (1000*10 + 500*50 + 10000*0.25 + 2000*20) / 1e6 = $0.0775.
const USAGE = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 10000, cache_creation_input_tokens: 2000 }

// Stands for the host: session state, Jev's answer, the model, and what was written.
const host = (on: On, jev = { choice: 'haiku', confidence: 0.9 }, hasKey = true, extraEnv: Record<string, string> = {}) => {
  const held = new Map<string, { value: unknown; version: number }>()
  const seen = { modelCalls: 0, fetched: [] as string[], written: [] as { path: string; text: string }[], toasts: [] as string[], spawned: [] as (string | undefined)[] }
  const world = { usage: { ...USAGE, model: 'claude-fable-5-1' } as (typeof USAGE & { model: string }) | null }
  mock.env(on, { HOME: '/home', ...(hasKey ? { TYPESAFE_API_KEY: 'k' } : {}), ...extraEnv })
  mock.store(on, { results: [{ type: 'Explore', model: 'haiku-4-5', result: 'completed', usd: 0.01, tokens: 900, at: 1 }] })
  const clock = mock.clock(on, { now: 1_000_000 })
  on('state.get', (_, e) => ({ value: held.get(`${e.plugin}.${e.key}`) ?? { value: undefined, version: 0 } }))
  on('state.set', (_, e) => {
    const version = (held.get(`${e.plugin}.${e.key}`)?.version ?? 0) + 1
    held.set(`${e.plugin}.${e.key}`, { value: e.value, version })
    return { value: { isSet: true, version } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.id', () => ({ value: 'sess1234abcd' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('agent.list', () => ({ value: [] }))
  on('fs.write', (_, e) => {
    seen.written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('http.fetch', (_, e) => {
    seen.fetched.push(e.init?.body ?? '')
    const answers = {
      model: { type: 'choice', choice: jev.choice, confidence: jev.confidence, probabilities: { haiku: 0.9, sonnet: 0.08, opus: 0.02 } },
      difficulty: { type: 'score', score: 1, legend: { '1': 'a lookup, rename or other mechanical step' }, confidence: 0.8 },
    }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ model: 'jev-1.13.0', answers, usage: { input_tokens: 500, output_tokens: 0 } }) } }
  })
  on('model.complete', () => {
    seen.modelCalls += 1
    return { value: { isAnswered: true, text: 'ok', usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: world.usage === null ? null : 'end_turn', usage: world.usage }
  })
  on('turn.complete', () => ({ text: '' }))
  on('session.append', (_, e, next) => next(e))
  on('agent.spawn', (_, e) => {
    seen.spawned.push(e.model)
    return { model: e.model === undefined ? e.parentModel : (IDS[e.model] ?? e.model), agentId: `a${seen.spawned.length}` }
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  const ledger = () => held.get('run-ledger.ledger')?.value as Ledger
  return { seen, world, clock, ledger }
}

const step = async ($: Engine, turnId: string, index: number, agentId?: string) => {
  for await (const _ of $.turn.step({ turnId, index, model: 'claude-fable-5-1', messageCount: 1, agentId })) void _
}
const done = ($: Engine, turnId: string, agentId?: string) =>
  $.turn.complete({ turnId, agentId, answer: '', durationMs: 1, isAborted: false, reason: 'answer', usage: { ...USAGE, model: 'claude-fable-5-1' } })
const spawn = ($: Engine, extra: { model?: string; background?: boolean; fork?: boolean; subagentType?: string } = {}) =>
  $.agent.spawn({
    tool_use_id: 't1',
    prompt: 'Rename foo to bar in every file under src.',
    description: 'rename foo',
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-fable-5-1',
    background: false,
    fork: false,
    ...extra,
  })
// The drawing as lines of text: one per Text, a Button by its label.
const flat = (node: unknown): string => {
  if (typeof node !== 'object' || node === null) return String(node)
  const el = node as { type: string; props: { label?: string }; children?: unknown[] }
  const inner = (el.children ?? []).map(flat).join('')
  return el.type === 'Button' ? `${el.props.label}\n` : el.type === 'Text' ? `${inner}\n` : inner
}
const drawn = async ($: Engine, surface: 'terminal' | 'desktop' = 'terminal') => {
  const ui = await $.ui.mount({ ...PANE, surface })
  const text = flat(await ui.drawn())
  await ui.unmount()
  return text
}
// The mocked state redraws nothing, so a press is read back from a fresh mount.
const press = async ($: Engine, key: string) => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key })
  await ui.unmount()
}

test('prices a run, labels it an estimate, and draws on terminal and desktop without a model call', async ($, on) => {
  const { seen, world, ledger } = host(on)
  await $.session.start(START)
  await $.turn.start({ turnId: 'r1', text: 'fix the parser' })
  await step($, 'r1', 0)
  await done($, 'r1')

  const line = ledger().runs[0]?.lines[0]
  expect(line?.requests).toBe(1)
  expect(line?.usd?.toFixed(6)).toBe('0.077500')
  expect(line?.usage).toEqual({ input: 1000, output: 500, cacheRead: 10000, cacheWrite: 2000 })

  for (const surface of ['terminal', 'desktop'] as const) {
    const text = await drawn($, surface)
    expect(text).toContain('$0.0775')
    expect(text).toContain('API estimate at list prices dated 2026-10-03, not a subscription charge.')
    expect(text).toContain('fable-5-1')
    expect(text).toContain('fix the parser')
    expect(text).toContain('cache read 10.0k')
  }

  // A model with no dated price, then a request that reported no usage: both read unknown.
  await $.turn.start({ turnId: 'r2', text: 'second' })
  world.usage = { ...USAGE, model: 'mystery-9' }
  await step($, 'r2', 0)
  world.usage = null
  await step($, 'r2', 1)
  expect(ledger().runs[1]?.lines.map(x => [x.model, x.usd, x.unreported])).toEqual([['mystery-9', null, 0], ['claude-fable-5-1', 0, 1]])
  expect(await drawn($)).toContain('$0.0775 + unknown')

  // Details of a run, back, and export.
  await press($, 'run-2')
  const details = await drawn($)
  expect(details).toContain('Run: fix the parser')
  expect(details).toContain('fable-5-1 · session · 1 req · in 1.0k, out 500, cache read 10.0k, cache write 2.0k · $0.0775')
  await press($, 'back')
  await press($, 'export')
  expect(seen.written[0]?.path).toMatch(/^\/home\/\.claude\/run-ledger-sess1234-\d+\.json$/)
  const exported = JSON.parse(seen.written[0]?.text ?? '{}')
  expect(exported.pricesAsOf).toBe('2026-10-03')
  expect(exported.note).toContain('not a subscription charge')
  expect(exported.runs).toHaveLength(2)

  expect((await $.command.run({ command: 'run-ledger', args: '', ...RAN })).text).toContain('not a subscription charge')
  expect(seen.modelCalls).toBe(0)
  expect(seen.fetched).toEqual([])
})

test('counts each request once', async ($, on) => {
  const { ledger } = host(on)
  await $.session.start(START)
  await $.turn.start({ turnId: 'r1', text: 'one' })
  await step($, 'r1', 0)
  await step($, 'r1', 0)
  await step($, 'r1', 0)
  // The turn's own total repeats the same request and must add nothing.
  await done($, 'r1')
  expect(ledger().runs[0]?.lines[0]?.requests).toBe(1)
  expect(ledger().runs[0]?.lines[0]?.usd?.toFixed(6)).toBe('0.077500')

  await $.turn.start({ turnId: 'r2', text: 'two' })
  await step($, 'r2', 0)
  await step($, 'r2', 1)
  expect(ledger().runs[1]?.lines[0]?.requests).toBe(2)

  // A retry notice counts once per notice.
  const notice = { message: { type: 'system' as const, name: 'api_error', content: [] }, door: 'notice' as const, origin: { kind: 'model' as const, model: 'claude-fable-5-1' }, uuid: 'u1' }
  // The kit has nothing beneath session.append, so the call rejects after the plugin's hook ran.
  await $.session.append(notice).catch(() => undefined)
  await $.session.append(notice).catch(() => undefined)
  expect(ledger().runs[1]?.retries).toBe(1)
})

test('a background subagent stays linked to the run that spawned it, with status, action and elapsed time', async ($, on) => {
  const { clock, ledger } = host(on)
  await $.session.start(START)
  await $.turn.start({ turnId: 'r1', text: 'spawn a worker' })
  await spawn($, { model: 'haiku', background: true })
  await done($, 'r1')

  await $.turn.start({ turnId: 'r2', text: 'unrelated' })
  await step($, 'r2', 0)
  // The worker's requests arrive during the next run.
  await step($, 'sub-1', 0, 'a1')
  // The kit types no loop for a call; the engine's own calls from a subagent carry its id.
  await $.tool.call({ tool: 'Bash', command: 'npm test', agentId: 'a1' } as never)
  await clock.advance(65_000)

  const [r1, r2] = ledger().runs
  expect(r1?.lines.find(x => x.agentId === 'a1')?.requests).toBe(1)
  expect(r2?.lines.some(x => x.agentId === 'a1')).toBe(false)
  expect(ledger().agents[0]).toMatchObject({ runId: 'r1', status: 'running', model: IDS.haiku, background: true, lastAction: 'Bash npm test' })

  const text = await drawn($)
  expect(text).toContain('running · Explore (background) · haiku-4-5 · 1:05 · Bash npm test')

  await done($, 'sub-1', 'a1')
  expect(ledger().agents[0]?.status).toBe('completed')
})

test("another plugin's model call and Jev call are attributed to that plugin", { plugins: [{
  name: 'helper',
  register: on => {
    on('command.run', { command: 'ask' }, async $ => {
      await $.model.complete({ model: 'haiku', prompt: 'label this' })
      await $.http.fetch('https://api.typesafe.ai/v1/systemone', { method: 'POST', body: '{}' })
      return { text: 'asked' }
    })
  },
}] }, async ($, on) => {
  const { ledger } = host(on)
  await $.session.start(START)
  await $.command.run({ command: 'ask', args: '', ...RAN })

  const lines = ledger().runs[0]?.lines ?? []
  expect(ledger().runs[0]?.id).toBe('between-turns')
  expect(lines.map(x => [x.plugin, x.model, x.requests])).toEqual([['helper', 'haiku', 1], ['helper', 'jev-1.13.0', 1]])
  // haiku: (100*1 + 20*5) / 1e6. Jev: 500 input tokens at $0.042 per million.
  expect(lines[0]?.usd?.toFixed(6)).toBe('0.000200')
  expect(lines[1]?.usd?.toFixed(6)).toBe('0.000021')
  expect(await drawn($)).toContain('By plugin: helper $0.000221')
})

test('recommends and never changes the model; shows recommended, actual, result and both costs', { options: { mode: 'recommend' } }, async ($, on) => {
  const { seen, ledger } = host(on)
  await $.session.start(START)
  await $.turn.start({ turnId: 'r1', text: 'delegate' })
  await spawn($, { model: 'opus' })
  await spawn($)
  await spawn($, { fork: true })

  expect(seen.spawned).toEqual(['opus', undefined, undefined])
  // Two asks: a fork is not asked about.
  expect(seen.fetched).toHaveLength(2)
  const asked = JSON.parse(seen.fetched[0] ?? '{}')
  expect(asked.state.task).toContain('Rename foo to bar')
  expect(asked.state.budget_usd).toBe(1)
  expect(asked.state.models).toContainEqual({ model: 'haiku', input_usd_per_mtok: 1, output_usd_per_mtok: 5, prices_as_of: '2026-10-03' })
  expect(asked.state.past_results).toHaveLength(1)
  expect(Object.keys(asked.questions.model.criteria)).toEqual(['haiku', 'sonnet', 'opus', 'insufficient_context'])

  const [first] = ledger().agents
  expect(first?.rec).toMatchObject({ model: 'haiku', confidence: 0.9, routed: false })
  expect(first?.rec?.why).toContain('Jev: haiku 90% (sonnet 8%, opus 2%); difficulty 1, a lookup')
  expect(ledger().runs[0]?.lines.find(x => x.plugin === 'run-ledger')).toMatchObject({ model: 'jev-1.13.0', requests: 2 })

  await step($, 'sub-1', 0, 'a1')
  await done($, 'sub-1', 'a1')
  const text = await drawn($)
  expect(text).toContain('rename foo: recommended haiku 90% · ran opus-5-5 (differs) · completed · ')
  expect(text).toContain('Jev $0.000021')
})

test('auto-route sets the model only for a call that named none', { options: { mode: 'auto-route' } }, async ($, on) => {
  const { seen, ledger } = host(on)
  await $.session.start(START)
  await $.turn.start({ turnId: 'r1', text: 'delegate' })
  await spawn($)
  await spawn($, { model: 'opus' })
  await spawn($, { fork: true })

  expect(seen.spawned).toEqual(['haiku', 'opus', undefined])
  expect(ledger().agents.map(a => a.rec?.routed)).toEqual([true, false, undefined])
  expect(await drawn($)).toContain('ran haiku-4-5 (auto-routed)')
})

test('auto-route leaves a low-confidence pick alone', { options: { mode: 'auto-route' } }, async ($, on) => {
  const { seen } = host(on, { choice: 'haiku', confidence: 0.4 })
  await $.session.start(START)
  await spawn($)
  expect(seen.spawned).toEqual([undefined])
})

test('off never calls Jev', { options: { mode: 'off' } }, async ($, on) => {
  const { seen, ledger } = host(on)
  await $.session.start(START)
  await spawn($)
  expect(seen.fetched).toEqual([])
  expect(ledger().agents[0]?.rec).toBeUndefined()
})

test('without a Jev key the spawn goes ahead and the recommendation reads unknown', { options: { mode: 'recommend' } }, async ($, on) => {
  const { seen, ledger } = host(on, undefined, false)
  await $.session.start(START)
  await spawn($, { model: 'sonnet' })
  expect(seen.spawned).toEqual(['sonnet'])
  expect(seen.fetched).toEqual([])
  expect(ledger().agents[0]?.rec).toMatchObject({ model: null, routed: false })
  expect(await drawn($)).toContain('recommended unknown')
})

test('without a key it says so once, not on every spawn', { options: { mode: 'recommend' } }, async ($, on) => {
  const { seen } = host(on, undefined, false)
  await $.session.start(START)
  await spawn($, { model: 'sonnet' })
  await spawn($, { model: 'sonnet' })
  expect(seen.toasts.filter(t => t.includes('TYPESAFE_API_KEY')).length).toBe(1)
  expect(seen.fetched).toEqual([])
})

test('the key from the plugin setting is used, and nothing reads a file', { options: { mode: 'recommend' } }, async ($, on) => {
  const { seen } = host(on, undefined, false, { CLAUDE_PLUGIN_OPTION_TYPESAFE_API_KEY: 'from-settings' })
  await $.session.start(START)
  await spawn($, { model: 'sonnet' })
  expect(seen.fetched.length).toBe(1)
})

test('the export goes to CLAUDE_CONFIG_DIR when set', async ($, on) => {
  const { seen } = host(on, undefined, true, { CLAUDE_CONFIG_DIR: '/cfg/alt' })
  await $.session.start(START)
  await $.command.run({ command: 'run-ledger', args: 'export', ...RAN })
  expect(seen.written[0]?.path).toMatch(/^\/cfg\/alt\/run-ledger-sess1234-\d+\.json$/)
})

test('a running subagent silent for 10 minutes is ended, and activity revives it', async ($, on) => {
  const { clock, ledger } = host(on)
  await $.session.start(START)
  await $.turn.start({ turnId: 'r1', text: 'spawn a worker' })
  await spawn($, { background: true })
  await clock.advance(9 * 60_000)
  expect(ledger().agents[0]?.status).toBe('running')
  await clock.advance(66_000)
  expect(ledger().agents[0]?.status).toBe('stale')
  await step($, 'r1', 0, 'a1')
  expect(ledger().agents[0]?.status).toBe('running')
})
