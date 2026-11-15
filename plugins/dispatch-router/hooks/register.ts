import type { EngineInterface, PluginOptions, Register } from 'claude-code'

// A model picks one of these for every dispatch. `when` is the criterion it reads.
type Cli = 'claude' | 'codex' | 'agy'
type Runner = { cli: Cli; model: string; launch: string; when: string }

const WHEN = {
  low: 'mechanical bulk work: renames, boilerplate, format conversion, repetitive sweeps',
  mid: 'reviewing code another agent wrote; writing docs, specs and briefs; work that needs this project\'s rules, hooks or memory',
  high: 'subtle algorithms, concurrency, hard debugging, adjudication or go/no-go calls, anything where a wrong answer is expensive',
  codex: 'writing or changing code, scripts or tests to a spec: the default for implementation tasks',
  agyLow: 'research: reading long documents, reports, repos or papers and writing a digest from them; bulk sweeps that need no project rules',
  agyHigh: 'a second-opinion review of another agent\'s output from a different model family',
}

let opts: PluginOptions = {}
let RUNNERS: Record<string, Runner> = {}

const str = (k: string, d = '') => String(opts[k] ?? d).trim()
const list = (v: string) => v.split(',').map(s => s.trim()).filter(Boolean)

function buildRunners(): Record<string, Runner> {
  const enabled = list(str('runners', 'claude'))
  const make = (cli: Cli, model: string, flagsKey: string, when: string): Runner => {
    const flag = model === '' ? '' : cli === 'codex' ? ` -m ${model}` : ` --model ${model}`
    return { cli, model, launch: `${cli}${flag} ${str(flagsKey)}`.trim(), when }
  }
  const all: Record<string, Runner> = {
    'claude-low': make('claude', str('claudeModelLow', 'haiku'), 'claudeFlags', WHEN.low),
    'claude-mid': make('claude', str('claudeModelMid', 'sonnet'), 'claudeFlags', WHEN.mid),
    'claude-high': make('claude', str('claudeModelHigh', 'opus'), 'claudeFlags', WHEN.high),
    codex: make('codex', str('codexModel'), 'codexFlags', WHEN.codex),
    'agy-low': make('agy', str('agyModelLow'), 'agyFlags', WHEN.agyLow),
    'agy-high': make('agy', str('agyModelHigh'), 'agyFlags', WHEN.agyHigh),
  }
  const on = enabled.length ? enabled : ['claude']
  return Object.fromEntries(Object.entries(all).filter(([, r]) => on.includes(r.cli)))
}

// Where the work runs. Cloud needs the model at least this sure, a Claude runner, and no local need.
const CLOUD_MIN_CONFIDENCE = 0.8
const PLACES = {
  cloud:
    'can be finished end to end in a fresh clone of the pushed GitHub branch: code, tests, docs or planning that need ' +
    'no local data, large files, API keys, local MCP servers or memory',
  local:
    'needs anything that exists only on this machine, even a little: untracked data, large files, a local environment, ' +
    'API keys, local MCP servers or memory',
}
type Place = keyof typeof PLACES

const API_URL = 'https://api.typesafe.ai/v1/systemone'
const USD_PER_M_INPUT = 0.042
const MIN_CONFIDENCE = 0.6
// A routed decision not launched within this window is forgotten.
const PENDING_MS = 30 * 60_000

type Decision = { runner: string; confidence: number; place: Place; at: number }

let pending: Decision[] = []

// Every runner name in `pending` came from ask, which checked it against RUNNERS.
const runnerOf = (d: Decision) => RUNNERS[d.runner] as Runner

function localOnly(text: string): boolean {
  const p = str('localOnlyPattern', '\\.env\\b|\\blfs\\b|/tmp/')
  try {
    return p !== '' && new RegExp(p, 'i').test(text)
  } catch {
    return true // a pattern that does not compile keeps everything local
  }
}

// `herdr agent start <name> --kind claude ...` (herdr is a terminal multiplexer; the other forms need no tool), or claude/codex/agy in command position
// (start, after && ; | ||, env prefixes allowed), or typed into a pane with send-keys or pane run.
const LAUNCH_KIND = /\bagent\s+start\b[^\n]*--kind\s+(claude|codex|agy)\b/
const LAUNCH_CMD = /(?:^|&&|\|\||;|\|)\s*(?:\w+=\S*\s+)*(claude|codex|agy)(?=\s|$)/m
const LAUNCH_KEYS = /(?:send-keys|pane\s+run)\b[^\n]*["'](?:\w+=\S*\s+)*(claude|codex|agy)(?=\s|["'])/
// Subcommands and flags that are not a session: `claude plugin validate`, `agy models`, `codex --version`.
const NOT_A_SESSION =
  /(?:^|&&|\|\||;|\|)\s*(?:\w+=\S*\s+)*(?:claude|codex|agy)\s+(?:plugin|auth|mcp|models?|agents?|update|install|doctor|changelog|login|logout|config|help|--version|--help|-v|-h)\b/m
const MODEL_FLAG = /(?:--model[ =]|(?:^|\s)-m\s+|\bmodel=)["']?([\w.-]+)/

function launchOf(command: string): { cli: Runner['cli']; model?: string } | undefined {
  if (/^\s*herdr\b.*\b(?:agent\s+prompt|tab\s+rename|agent\s+rename)\b/.test(command)) return undefined
  if (NOT_A_SESSION.test(command)) return undefined
  const m = LAUNCH_KIND.exec(command) ?? LAUNCH_CMD.exec(command) ?? LAUNCH_KEYS.exec(command)
  if (m === null) return undefined
  return { cli: m[1] as Runner['cli'], model: MODEL_FLAG.exec(command)?.[1] }
}

const apiKey = async ($: EngineInterface): Promise<string | undefined> =>
  str('typesafeApiKey') || (await $.env.get('TYPESAFE_API_KEY')) || undefined

type Answer = { runner: string; confidence: number; cloud: boolean; cloudConfidence: number; tokens: number }

async function ask($: EngineInterface, task: string): Promise<Answer> {
  const key = await apiKey($)
  if (key === undefined) throw new Error('no TypeSafe API key')
  const questions: Record<string, unknown> = {
    runner: {
      type: 'choice',
      instructions:
        'Which runner should an orchestrator dispatch `task` to? Pick the cheapest one that would do it well. ' +
        'claude runners load the project rules, CLAUDE.md and memory; codex and agy do not.',
      criteria: Object.fromEntries(Object.entries(RUNNERS).map(([k, r]) => [k, r.when])),
    },
  }
  if (opts.allowCloud === true) {
    questions.place = {
      type: 'choice',
      instructions: 'Can `task` run in a cloud session that only has a clone of the GitHub repo? If in doubt, local.',
      criteria: PLACES,
    }
  }
  const res = await $.http.fetch(API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: { task: task.slice(0, 4000) }, model: 'jev-latest', questions }),
  })
  if (!res.ok) throw new Error(`TypeSafe answered HTTP ${res.status}`)
  const json = JSON.parse(res.text)
  const a = json.answers.runner
  const p = json.answers.place
  if (!Object.hasOwn(RUNNERS, a.choice)) throw new Error(`TypeSafe picked an unknown runner: ${a.choice}`)
  return { runner: a.choice, confidence: a.confidence, cloud: p?.choice === 'cloud', cloudConfidence: p?.confidence ?? 0, tokens: json.usage?.input_tokens ?? 0 }
}

// ponytail: read-then-write append; the log is small. Switch to $.store counters if it ever matters.
async function log($: EngineInterface, row: Record<string, unknown>) {
  const dir = (await $.env.get('CLAUDE_PLUGIN_DATA')) || `${(await $.env.get('HOME')) ?? ''}/.claude`
  const path = `${dir}/dispatch-router.log.jsonl`
  let old = ''
  try {
    old = await $.fs.read(path)
  } catch {}
  await $.fs.write(path, old + JSON.stringify({ ts: new Date().toISOString(), ...row }) + '\n')
}

function prune() {
  const cutoff = Date.now() - PENDING_MS
  pending = pending.filter(d => d.at > cutoff)
}

function take(cli: Cli, model: string | undefined, place: Place): Decision | undefined {
  prune()
  const i = pending.findIndex(d => d.place === place && runnerOf(d).cli === cli && (place === 'cloud' || runnerOf(d).model === '' || runnerOf(d).model === model))
  if (i < 0) return undefined
  return pending.splice(i, 1)[0]
}

function pendingText() {
  prune()
  return pending.length === 0
    ? 'No routed dispatch is pending.'
    : `Pending: ${pending.map(d => (d.place === 'cloud' ? `${d.runner} in cloud (claude --cloud "<brief>")` : `${d.runner} (${runnerOf(d).launch})`)).join('; ')}.`
}

function refusal(what: string) {
  return (
    `dispatch-router: ${what} ${pendingText()} ` +
    'Call mcp__dispatch-router__route with the task text first, then launch exactly what it returns.'
  )
}

export const register: Register = (on, options) => {
  opts = options
  RUNNERS = buildRunners()
  pending = []

  on('session.start', async ($, e, next) => {
    if ((await apiKey($)) === undefined) {
      $.ui.toast('dispatch-router: no TypeSafe API key, so it does nothing. Set its typesafeApiKey option or TYPESAFE_API_KEY.')
      return next(e)
    }
    await $.tool.register({
      name: 'route',
      description:
        'Before spawning any agent (terminal tab, Agent tool' + (opts.allowCloud === true ? ', cloud session' : '') + '), pass the task text, the paths it touches and ' +
        `anything local it needs. A TypeSafe model picks the CLI and model (${Object.keys(RUNNERS).join(', ')}) ` +
        'and returns the launch command and the files the brief must point at. ' +
        'A launch that was not routed, or carries a different model, is refused.',
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'The ticket or brief, as the agent will receive it.' },
          note: { type: 'string', description: 'Why you disagree with the previous routing, if re-routing.' },
          paths: { type: 'array', items: { type: 'string' }, description: 'Files and folders the work reads or writes.' },
          local_needs: {
            type: 'array',
            items: { type: 'string' },
            description: 'Anything it needs that exists only on this machine (data, large files, API keys, local MCP, memory). Any entry forces local.',
          },
          user_said_cloud: {
            type: 'string',
            description: "The user's own words asking for cloud, quoted verbatim. Only when they asked; never inferred. Overrides the model's place judgment, not local_needs or the local-only check.",
          },
        },
        required: ['task'],
      },
    })
    return next(e)
  })

  on('tool.call', { tool: 'mcp__dispatch-router__route' }, async ($, e) => {
    const task = String(e.task ?? '')
    const note = e.note === undefined ? '' : `\n\nOrchestrator note: ${String(e.note)}`
    const paths = Array.isArray(e.paths) ? e.paths.map(String) : []
    const needs = Array.isArray(e.local_needs) ? e.local_needs.map(String) : []
    const asked = String(e.user_said_cloud ?? '').trim()
    const details = [paths.length ? `Paths: ${paths.join(', ')}` : '', needs.length ? `Local needs: ${needs.join(', ')}` : '']
      .filter(Boolean)
      .join('\n')
    let a: Answer
    try {
      a = await ask($, task + (details ? `\n\n${details}` : '') + note)
    } catch (err) {
      return { result: `dispatch-router: the routing call failed (${(err as Error).message}). Nothing routed; fix the key or network and call route again.` }
    }
    const r = RUNNERS[a.runner] as Runner
    const cloudOn = opts.allowCloud === true
    const why =
      !cloudOn ? 'cloud sessions are switched off'
      : needs.length > 0 ? `local need: ${needs.join(', ')}`
      : localOnly([task, ...paths].join('\n')) ? 'touches local-only data'
      : r.cli !== 'claude' ? `${r.cli} has no cloud lane`
      : asked !== '' ? ''
      : !a.cloud ? 'the model says local'
      : a.cloudConfidence < CLOUD_MIN_CONFIDENCE ? `only ${(a.cloudConfidence * 100).toFixed(0)}% sure of cloud`
      : ''
    const d: Decision = { runner: a.runner, confidence: a.confidence, place: why === '' ? 'cloud' : 'local', at: Date.now() }
    pending.push(d)
    await log($, { runner: d.runner, confidence: +d.confidence.toFixed(3), place: d.place, why, input_tokens: a.tokens, rerouted: note !== '', user_said_cloud: asked || undefined })
    const files = r.cli === 'claude' ? [] : list(str('briefFiles', 'AGENTS.md'))
    $.ui.status(`routed: ${d.runner} ${d.place} ${(d.confidence * 100).toFixed(0)}%`)
    const head = `Routed to ${d.runner} (${(d.confidence * 100).toFixed(0)}% sure${d.confidence < MIN_CONFIDENCE ? ', low; re-route with a note if you disagree' : ''}). The model read ${a.tokens} tokens ($${((a.tokens * USD_PER_M_INPUT) / 1e6).toFixed(5)}).`
    if (d.place === 'cloud') {
      return {
        result: [
          head,
          `Place: cloud (${(a.cloudConfidence * 100).toFixed(0)}% sure). Launch it yourself:`,
          '1. Commit and push the branch the work starts from; the cloud clones the GitHub remote, not this checkout.',
          '2. Run claude --cloud "<the full brief>" in a terminal (it needs one, so not a background Bash call). It prints the session URL.',
          '3. Give the user the session URL. No local worktree. Launch within 30 minutes.',
        ].join('\n'),
      }
    }
    return {
      result: [
        head,
        `Place: local (${why}). Launch it in a new terminal tab or window.`,
        `Launch: ${r.launch}`,
        r.cli === 'claude'
          ? `Agent tool: pass model: "${r.model}".`
          : `${r.cli} does not load the project rules. The brief must point at: ${files.join(', ') || 'the files it needs'}.`,
        r.model === '' ? 'Launch within 30 minutes.' : 'Launch within 30 minutes; the model flag must match.',
      ].join('\n'),
    }
  })

  // No key (or no pending route tool): nothing to route with, so nothing is enforced.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const launch = launchOf(e.command)
    if (launch === undefined || (await apiKey($)) === undefined) return next(e)
    if (/--(?:cloud|remote)\b/.test(e.command)) {
      // `-p --cloud <id>` messages a running session; only a new session is a dispatch.
      if (/(?:^|\s)(?:-p|--print)\b/.test(e.command)) return next(e)
      const d = take(launch.cli, undefined, 'cloud')
      if (d === undefined) return { deny: refusal('no routed decision sends this work to the cloud.') }
      $.ui.status(`launched: ${d.runner} in cloud`)
      return next(e)
    }
    if (!Object.values(RUNNERS).some(r => r.cli === launch.cli)) return next(e) // a CLI not listed in `runners`
    const d = take(launch.cli, launch.model, 'local')
    if (d === undefined) {
      return { deny: refusal(launch.model === undefined ? `${launch.cli} launch has no model flag, or no routed decision matches it.` : `no routed local decision matches ${launch.cli} --model ${launch.model}.`) }
    }
    $.ui.status(`launched: ${d.runner}`)
    return next(e)
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    if (e.subagent_type === 'fork' || (await apiKey($)) === undefined || !Object.values(RUNNERS).some(r => r.cli === 'claude')) return next(e)
    if (e.model === undefined) return { deny: refusal('Agent call has no model.') }
    const d = take('claude', e.model, 'local')
    if (d === undefined) return { deny: refusal(`no routed local decision matches Agent model ${e.model}.`) }
    $.ui.status(`launched: ${d.runner}`)
    return next(e)
  })
}
