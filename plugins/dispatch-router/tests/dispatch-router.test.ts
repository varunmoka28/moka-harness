import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const
const ALL = { runners: 'claude,codex,agy', codexModel: 'codex-x', agyModelLow: 'agy-lo', agyModelHigh: 'agy-hi', typesafeApiKey: 'k', codexFlags: '-s workspace-write' }

// Stands for the host: the routing answer, the env, the log file, and what the model was told.
const host = (on: On, runner: string, confidence = 0.9, env: Record<string, string> = {}, place = { choice: 'local', confidence: 0.9 }) => {
  const seen = { fetched: [] as string[], written: [] as string[], paths: [] as string[], reads: [] as string[], registered: [] as string[], status: [] as (string | undefined)[], toasts: [] as string[], auth: [] as string[] }
  mock.env(on, { HOME: '/home', ...env })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('tool.register', (_, e) => {
    seen.registered.push(e.name)
    return { value: { tool: `mcp__dispatch-router__${e.name}` } }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.status', (_, e) => {
    seen.status.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('fs.read', (_, e) => {
    seen.reads.push(e.path)
    throw new Error('no log yet')
  })
  on('fs.write', (_, e) => {
    seen.paths.push(e.path)
    seen.written.push(e.text)
    return { value: undefined }
  })
  on('http.fetch', (_, e) => {
    seen.fetched.push(String(e.init?.body ?? ''))
    seen.auth.push((e.init?.headers as Record<string, string>)?.Authorization ?? '')
    return {
      value: {
        status: 200,
        ok: true,
        headers: {},
        text: JSON.stringify({ answers: { runner: { type: 'choice', choice: runner, confidence }, place: { type: 'choice', ...place } }, usage: { input_tokens: 300 } }),
      },
    }
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'spawned' }))
  return seen
}

const route = ($: Parameters<TestBody>[0], task: string, extra: Record<string, unknown> = {}) =>
  $.tool.call({ tool: 'mcp__dispatch-router__route', task, ...extra })
const bash = ($: Parameters<TestBody>[0], command: string) => $.tool.call({ tool: 'Bash', command })

test('routes to codex and lets only the matching launch through', { options: ALL }, async ($, on) => {
  const seen = host(on, 'codex', 0.82)
  await $.session.start(START)
  expect(seen.registered).toEqual(['route'])

  const r = await route($, 'Implement the parser from the spec.')
  expect(r.result).toContain('Routed to codex (82% sure)')
  expect(r.result).toContain('codex -m codex-x -s workspace-write')
  expect(r.result).toContain('AGENTS.md')
  expect(seen.fetched[0]).toContain('"task":"Implement the parser')
  expect(seen.fetched[0]).not.toContain('"place"')
  expect(seen.written[0]).toContain('"runner":"codex"')
  expect(seen.written[0]).not.toContain('parser')

  expect((await bash($, 'herdr agent start x --kind codex --pane p -- -m other -s workspace-write')).deny).toContain('no routed local decision matches codex')
  expect((await bash($, 'codex -s workspace-write -a never')).deny).toContain('no model flag')
  expect((await bash($, 'codex -m codex-x -s workspace-write')).deny).toBeUndefined()
  expect((await bash($, 'codex -m codex-x -s workspace-write')).deny).toContain('No routed dispatch is pending')
})

test('Agent tool needs a routed claude model; forks and non-launch commands pass', async ($, on) => {
  host(on, 'claude-mid', 0.9, { TYPESAFE_API_KEY: 'k' })
  await $.session.start(START)
  expect((await $.tool.call({ tool: 'Agent', prompt: 'x', description: 'x', subagent_type: 'Explore' })).deny).toContain('Agent call has no model')
  expect((await $.tool.call({ tool: 'Agent', prompt: 'x', description: 'x', subagent_type: 'fork' })).deny).toBeUndefined()
  expect((await bash($, 'claude plugin validate .')).deny).toBeUndefined()
  expect((await bash($, 'herdr agent prompt w1:p2 "ask claude to --model opus"')).deny).toBeUndefined()
  await route($, 'Review the diff against the spec.')
  expect((await $.tool.call({ tool: 'Agent', prompt: 'x', description: 'x', subagent_type: 'Explore', model: 'opus' })).deny).toContain('no routed local decision matches Agent model opus')
  expect((await $.tool.call({ tool: 'Agent', prompt: 'x', description: 'x', subagent_type: 'Explore', model: 'sonnet' })).deny).toBeUndefined()
})

test('a low confidence is flagged and a model-less runner matches on the CLI', { options: { ...ALL, agyModelLow: '' } }, async ($, on) => {
  host(on, 'agy-low', 0.45)
  await $.session.start(START)
  const r = await route($, 'Read the three reports and write a brief.')
  expect(r.result).toContain('low; re-route')
  expect(r.result).toContain('agy does not load the project rules')
  expect((await bash($, "herdr pane run w1:p3 'agy --dangerously-skip-permissions'")).deny).toBeUndefined()
})

test('without a key it does nothing and says so once', async ($, on) => {
  const seen = host(on, 'codex')
  await $.session.start(START)
  expect(seen.registered).toEqual([])
  expect(seen.toasts).toHaveLength(1)
  expect(seen.toasts[0]).toContain('no TypeSafe API key')
  expect((await bash($, 'codex -s workspace-write')).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Agent', prompt: 'x', description: 'x', subagent_type: 'Explore' })).deny).toBeUndefined()
  expect(seen.fetched).toEqual([])
})

test('the key comes from the option or the environment, and no .env file is read', { options: { typesafeApiKey: 'opt-key' } }, async ($, on) => {
  const seen = host(on, 'claude-mid', 0.9, { TYPESAFE_API_KEY: 'env-key' })
  await $.session.start(START)
  await route($, 'implement')
  expect(seen.auth).toEqual(['Bearer opt-key'])
  expect(seen.reads.filter(p => p.endsWith('.env'))).toEqual([])
})

test('the log goes under CLAUDE_PLUGIN_DATA', { options: ALL }, async ($, on) => {
  const seen = host(on, 'codex', 0.9, { CLAUDE_PLUGIN_DATA: '/data' })
  await $.session.start(START)
  await route($, 'implement')
  expect(seen.paths).toEqual(['/data/dispatch-router.log.jsonl'])
})

const CLOUD = { choice: 'cloud', confidence: 0.92 }
const CLOUD_ON = { ...ALL, allowCloud: true }

test('a sure cloud call on a Claude runner goes to the cloud, and only a cloud launch takes it', { options: CLOUD_ON }, async ($, on) => {
  const seen = host(on, 'claude-mid', 0.9, {}, CLOUD)
  await $.session.start(START)
  const r = await route($, 'Write the products doc from the spec.', { paths: ['docs/products'] })
  expect(r.result).toContain('Place: cloud (92% sure)')
  expect(r.result).toContain('claude --cloud')
  expect(seen.fetched[0]).toContain('"place"')
  expect(seen.written[0]).toContain('"place":"cloud"')
  expect((await bash($, 'claude --model sonnet')).deny).toContain('no routed local decision')
  expect((await bash($, 'claude --cloud "Write the products doc"')).deny).toBeUndefined()
  expect((await bash($, 'claude --cloud "again"')).deny).toContain('no routed decision sends this work to the cloud')
  expect((await bash($, `herdr-app do tab.new --name "cloud: x" --folder /repo --argv '["zsh","-lc","claude --cloud \\"$(cat /tmp/b.md)\\""]' --focus false`)).deny).toContain('no routed decision sends this work to the cloud')
  expect((await bash($, 'claude -p "status?" --cloud abc123')).deny).toBeUndefined()
})

test('a local need, local-only path, non-Claude runner or unsure model keeps the work local', { options: CLOUD_ON }, async ($, on) => {
  host(on, 'claude-mid', 0.9, {}, CLOUD)
  await $.session.start(START)
  expect((await route($, 'Rebuild', { local_needs: ['private data'] })).result).toContain('Place: local (local need: private data)')
  expect((await route($, 'Refit', { paths: ['secrets/.env'] })).result).toContain('Place: local (touches local-only data)')
})

test('codex keeps its local lane even when the model says cloud', { options: CLOUD_ON }, async ($, on) => {
  host(on, 'codex', 0.9, {}, CLOUD)
  await $.session.start(START)
  expect((await route($, 'Implement the API')).result).toContain('Place: local (codex has no cloud lane)')
})

test('cloud below 80% stays local', { options: CLOUD_ON }, async ($, on) => {
  host(on, 'claude-mid', 0.9, {}, { choice: 'cloud', confidence: 0.7 })
  await $.session.start(START)
  expect((await route($, 'Tidy the docs index')).result).toContain('Place: local (only 70% sure of cloud)')
})

test('with cloud off everything is local and no place question is sent', { options: { typesafeApiKey: 'k' } }, async ($, on) => {
  const seen = host(on, 'claude-mid', 0.9, {}, CLOUD)
  await $.session.start(START)
  expect((await route($, 'Tidy the docs index')).result).toContain('Place: local (cloud sessions are switched off)')
  expect(seen.fetched[0]).not.toContain('"place"')
})

test('/dispatch-router off stops the checks for the session and on restores them', { options: ALL }, async ($, on) => {
  const seen = host(on, 'codex')
  await $.session.start(START)
  expect((await bash($, 'codex -s workspace-write')).deny).toBeDefined()
  expect((await $.command.run({ command: 'dispatch-router', args: 'off' })).text).toContain('off for this session')
  expect(seen.status.at(-1)).toBeUndefined()
  expect((await bash($, 'codex -s workspace-write')).deny).toBeUndefined()
  expect((await route($, 'anything')).result).toContain('is off for this session')
  await $.command.run({ command: 'dispatch-router', args: 'on' })
  expect((await bash($, 'codex -s workspace-write')).deny).toBeDefined()
})
