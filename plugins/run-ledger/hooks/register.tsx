import { atom, read, update } from 'claude-code'
import type { AgentSpawnInput, EngineInterface, ModelUsage, Register } from 'claude-code'

import type { Agent, Ledger, Line, Rec, Run, Usage } from '../types'
import { PRICES_AS_OF, cost, priceOf } from './prices'

const PANE = 'run-ledger'
const LABEL = `API estimate at list prices dated ${PRICES_AS_OF}, not a subscription charge.`
// Requests made while no turn is open and no known agent is running land here.
const IDLE = 'between-turns'
// ponytail: the session keeps its last 40 runs; older ones drop off. Raise it, or move the
// runs to a state family, if a session ever needs more.
const KEPT_RUNS = 40
// An agent still marked running with no request or tool call for this long is taken to be gone
// (killed, or never listed by the engine); later activity from it revives it.
const STALE_MS = 10 * 60_000

const ledger = atom({ plugin: 'run-ledger', key: 'ledger' } as const, { runs: [], agents: [] })
const detail = atom({ plugin: 'run-ledger', key: 'detail' } as const, null)
const tick = atom({ plugin: 'run-ledger', key: 'tick' } as const, 0)

const NONE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
const usageOf = (u: ModelUsage): Usage => ({
  input: u.input_tokens,
  output: u.output_tokens,
  cacheRead: u.cache_read_input_tokens,
  cacheWrite: u.cache_creation_input_tokens,
})

const edit = ($: EngineInterface, change: (l: Ledger) => void) =>
  update($, ledger, old => {
    const l = JSON.parse(JSON.stringify(old)) as Ledger
    change(l)
    return l
  })

// The hot paths (every request, every subagent tool call) copy only what they change: the two lists
// and the records they touch, not the whole ledger.
const touch = ($: EngineInterface, change: (l: Ledger) => void) =>
  update($, ledger, old => {
    const l: Ledger = { ...old, runs: [...old.runs], agents: [...old.agents] }
    change(l)
    return l
  })

// Replaces an item of a list with a copy of itself, once, and returns the copy.
function own<T extends object>(list: T[], item: T): T {
  const copy = { ...item }
  list[list.indexOf(item)] = copy

  return copy
}

// A run's `seen` stays an array in the state; this Set, kept per array, makes the lookup O(1).
const keys = new WeakMap<string[], Set<string>>()
function seenKeys(run: Run) {
  let set = keys.get(run.seen)
  if (set === undefined) keys.set(run.seen, (set = new Set(run.seen)))

  return set
}
function firstSight(run: Run, key: string) {
  const set = seenKeys(run)
  if (set.has(key)) return false
  set.add(key)
  run.seen.push(key)

  return true
}

// The agent's record, made on first sight for one the ledger never saw spawn (a workflow's
// agent, an engine fork): it stays linked to the run that was open then.
function agentOf(l: Ledger, id: string, now: number): Agent {
  let a = l.agents.find(x => x.id === id)
  if (a === undefined) {
    a = { id, runId: runOf(l, undefined, now).id, type: 'unlisted', task: '', model: null, plugin: 'unknown', status: 'running', lastAction: '', startedAt: now, activeAt: now, background: false }
    l.agents.push(a)
  }
  return a
}

// An agent's requests belong to the run it was spawned in, however late they come.
function runOf(l: Ledger, agentId: string | undefined, now: number): Run {
  const open = l.runs.findLast(r => r.endedAt === undefined && r.id !== IDLE)
  const id = (agentId === undefined ? undefined : agentOf(l, agentId, now).runId) ?? open?.id ?? IDLE
  let run = l.runs.find(r => r.id === id)
  if (run === undefined) {
    run = { id, task: id === IDLE ? '(between turns)' : '(run no longer kept)', startedAt: now, retries: 0, lines: [], seen: [] }
    l.runs.push(run)
  }
  return run
}

type Request = {
  // Names the request; one seen before is not counted again. Absent for a call that is one dispatch.
  key?: string
  // The loop that made it, and the loop whose run it belongs to when that differs.
  agentId?: string
  runVia?: string
  model: string
  plugin?: string
  usage: Usage | null
}

function count(l: Ledger, q: Request, now: number) {
  const found = q.agentId === undefined ? undefined : agentOf(l, q.agentId, now)
  const open = runOf(l, q.agentId ?? q.runVia, now)
  if (q.key !== undefined && seenKeys(open).has(q.key)) return
  const agent = found && own(l.agents, found)
  const run = own(l.runs, open)
  run.lines = [...run.lines]
  if (q.key !== undefined) firstSight(run, q.key)
  if (agent !== undefined) {
    agent.activeAt = now
    if (agent.status !== 'running') {
      agent.status = 'running'
      delete agent.endedAt
    }
  }
  const plugin = q.plugin ?? agent?.plugin ?? 'session'
  const had = run.lines.find(x => x.model === q.model && x.plugin === plugin && x.agentId === q.agentId)
  let line: Line
  if (had === undefined) {
    line = { model: q.model, plugin, agentId: q.agentId, requests: 0, unreported: 0, usage: { ...NONE }, usd: cost(q.model, NONE) }
    run.lines.push(line)
  } else {
    line = own(run.lines, had)
    line.usage = { ...line.usage }
  }
  line.requests += 1
  if (q.usage === null) {
    line.unreported += 1
    return
  }
  line.usage.input += q.usage.input
  line.usage.output += q.usage.output
  line.usage.cacheRead += q.usage.cacheRead
  line.usage.cacheWrite += q.usage.cacheWrite
  const added = cost(q.model, q.usage)
  if (added !== null && line.usd !== null) line.usd += added
}

// ---- Jev: the same key and endpoint dispatch-router uses.

const JEV_URL = 'https://api.typesafe.ai/v1/systemone'
const MIN_CONFIDENCE = 0.6
// What a subagent may be routed to. The session's own top model is left out on purpose.
const CANDIDATES: Record<string, string> = {
  haiku: 'mechanical bulk work: renames, boilerplate, format conversion, log or file triage, simple lookups',
  sonnet: 'well-specified implementation, review, research or writing with clear acceptance criteria',
  opus: 'subtle algorithms, concurrency, gnarly debugging, adjudication, anything where a wrong answer is expensive',
}
const NO_PICK = 'insufficient_context'
const LEVELS = [
  'a lookup, rename or other mechanical step',
  'routine work with a clear spec',
  'multi-step work that needs judgment',
  'subtle or high-stakes reasoning',
]

type Past = { type: string; model: string; result: string; usd: number | null; tokens: number; at: number }
type JevAnswer = { choice?: string; confidence?: number; probabilities?: Record<string, number>; score?: number; legend?: Record<string, string> }
type JevReply = { model?: string; answers?: Record<string, JevAnswer>; usage?: { input_tokens?: number } }

const pct = (p: number | undefined) => (p === undefined ? '?' : `${Math.round(p * 100)}%`)
const pastOf = async ($: EngineInterface) => ((await $.store.get('results')) as Past[] | undefined) ?? []

// Claude Code exports the plugin's userConfig value to the mod as CLAUDE_PLUGIN_OPTION_TYPESAFE_API_KEY.
// TYPESAFE_API_KEY in the environment works too. No file is read.
async function apiKey($: EngineInterface): Promise<string | undefined> {
  return (await $.env.get('CLAUDE_PLUGIN_OPTION_TYPESAFE_API_KEY')) || (await $.env.get('TYPESAFE_API_KEY')) || undefined
}

// Jev answers typed questions and writes no prose, so the reason is assembled here from
// what it returned: its pick, the probability of each option, and the difficulty level.
async function askJev($: EngineInterface, e: AgentSpawnInput, budgetUsd: number): Promise<{ rec: Rec; tokens: number; model: string }> {
  const key = await apiKey($)
  if (key === undefined) throw new Error('no TYPESAFE_API_KEY')
  const body = {
    state: {
      task: e.prompt.slice(0, 4000),
      agent_type: e.subagentType,
      budget_usd: budgetUsd,
      models: Object.keys(CANDIDATES).map(m => ({
        model: m,
        input_usd_per_mtok: priceOf(m)?.input,
        output_usd_per_mtok: priceOf(m)?.output,
        prices_as_of: PRICES_AS_OF,
      })),
      past_results: (await pastOf($)).filter(p => p.type === e.subagentType).slice(-8),
    },
    model: 'jev-latest',
    questions: {
      model: {
        type: 'choice',
        instructions:
          'Which model in `models` should run the subagent `task`? Pick the cheapest one that would do it well ' +
          'within `budget_usd`. `past_results` lists how earlier tasks of this agent type went on each model.',
        criteria: { ...CANDIDATES, [NO_PICK]: 'the task text does not say enough to choose' },
      },
      difficulty: { type: 'score', instructions: 'How demanding is `task`?', criteria: LEVELS },
    },
  }
  const res = await $.http.fetch(JEV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Jev answered HTTP ${res.status}`)
  const json = JSON.parse(res.text) as JevReply
  const pick = json.answers?.model ?? {}
  const hard = json.answers?.difficulty
  const tokens = json.usage?.input_tokens ?? 0
  const model = json.model ?? 'jev-latest'
  const isPick = pick.choice !== undefined && pick.choice in CANDIDATES
  const others = Object.entries(pick.probabilities ?? {})
    .filter(([k]) => k !== pick.choice)
    .map(([k, p]) => `${k} ${pct(p)}`)
    .join(', ')
  const level = hard?.score === undefined ? '' : `; difficulty ${hard.score}${hard.legend?.[String(hard.score)] ? `, ${hard.legend[String(hard.score)]}` : ''}`
  const why = isPick
    ? `Jev: ${pick.choice} ${pct(pick.confidence)}${others ? ` (${others})` : ''}${level}; fits: ${CANDIDATES[pick.choice as string]}`
    : 'Jev: the task text does not say enough to choose'
  const rec: Rec = { model: isPick ? (pick.choice as string) : null, confidence: pick.confidence ?? null, why, routed: false, jevUsd: cost(model, { ...NONE, input: tokens }) }
  return { rec, tokens, model }
}

// ---- What the pane and the export read. Nothing below calls a model.

type Total = { usd: number; isPartial: boolean; requests: number; usage: Usage }

const total = (lines: readonly Line[]): Total =>
  lines.reduce<Total>(
    (t, x) => ({
      usd: t.usd + (x.usd ?? 0),
      isPartial: t.isPartial || x.usd === null || x.unreported > 0,
      requests: t.requests + x.requests,
      usage: {
        input: t.usage.input + x.usage.input,
        output: t.usage.output + x.usage.output,
        cacheRead: t.usage.cacheRead + x.usage.cacheRead,
        cacheWrite: t.usage.cacheWrite + x.usage.cacheWrite,
      },
    }),
    { usd: 0, isPartial: false, requests: 0, usage: NONE },
  )

// Six places under a cent, so a Jev call does not read as $0.0000.
const usd = (n: number) => `$${n.toFixed(n > 0 && n < 0.01 ? 6 : 4)}`
const money = (t: Total) => (!t.isPartial ? usd(t.usd) : t.usd > 0 ? `${usd(t.usd)} + unknown` : 'unknown')
const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n))
const usageText = (u: Usage) => `in ${tokens(u.input)}, out ${tokens(u.output)}, cache read ${tokens(u.cacheRead)}, cache write ${tokens(u.cacheWrite)}`
const short = (model: string | null) => (model === null ? 'unknown' : model.replace(/^claude-/, '').replace(/-\d{8}$/, ''))
const elapsed = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`
const allLines = (l: Ledger) => l.runs.flatMap(r => r.lines)
const retriesOf = (l: Ledger) => l.runs.reduce((n, r) => n + r.retries, 0)
const agentLines = (l: Ledger, a: Agent) => l.runs.flatMap(r => r.lines.filter(x => x.agentId === a.id))

function grouped(lines: readonly Line[], by: (x: Line) => string) {
  const groups = new Map<string, Line[]>()
  for (const x of lines) groups.set(by(x), [...(groups.get(by(x)) ?? []), x])
  return [...groups].map(([name, some]) => `${name} ${money(total(some))}`).join(' · ')
}

function summary(l: Ledger) {
  const t = total(allLines(l))
  return `Session ${money(t)} over ${t.requests} requests. Tokens: ${usageText(t.usage)}. Retries: ${retriesOf(l)}. ${LABEL}`
}

async function exportLedger($: EngineInterface) {
  const now = await $.clock.now()
  const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) || `${(await $.env.get('HOME')) ?? ''}/.claude`
  const path = `${dir}/run-ledger-${(await $.session.id()).slice(0, 8)}-${now}.json`
  const l = await read($, ledger)
  await $.fs.write(path, JSON.stringify({ note: LABEL, pricesAsOf: PRICES_AS_OF, exportedAt: new Date(now).toISOString(), summary: summary(l), ...l }, null, 2))
  $.ui.toast(`run-ledger: exported to ${path}`)
  return path
}

function action(e: { tool: unknown }) {
  const args = e as Record<string, unknown>
  const hint = ['command', 'file_path', 'pattern', 'description', 'url', 'query'].map(k => args[k]).find(v => typeof v === 'string')
  return `${String(e.tool)}${typeof hint === 'string' ? ` ${hint.slice(0, 48)}` : ''}`
}

const ENDED = { answer: 'completed', aborted: 'aborted', refusal: 'failed', error: 'failed' } as const

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'run-ledger', description: 'Open the run ledger pane; "export" writes it to a JSON file' })
    // Keeps elapsed times moving while a subagent runs and nothing else changes.
    $.clock.every(5000, async () => {
      const now = await $.clock.now()
      const stale = (a: Agent) => a.status === 'running' && now - (a.activeAt ?? a.startedAt) > STALE_MS
      if ((await read($, ledger)).agents.some(stale))
        await edit($, l =>
          l.agents.filter(stale).forEach(a => {
            a.status = 'stale'
            a.endedAt = a.activeAt ?? a.startedAt
          }),
        )
      if ((await read($, ledger)).agents.some(a => a.status === 'running')) await update($, tick, n => n + 1)
    })
    return next(e)
  })

  on('command.run', { command: 'run-ledger' }, async ($, e) => {
    if (e.args.trim() === 'export') return { text: `Exported to ${await exportLedger($)}` }
    await $.ui.open({ id: PANE, title: 'Run ledger' })
    return { text: summary(await read($, ledger)) }
  })

  on('turn.start', async ($, e, next) => {
    const now = await $.clock.now()
    await edit($, l => {
      l.runs.push({ id: e.turnId, task: e.text.replace(/\s+/g, ' ').slice(0, 80), startedAt: now, retries: 0, lines: [], seen: [] })
      l.runs = l.runs.slice(-KEPT_RUNS)
      l.agents = l.agents.filter(a => a.status === 'running' || l.runs.some(r => r.id === a.runId))
    })
    return next(e)
  })

  // One request of a loop. The step's usage is the only place it is counted: the turn's
  // total at turn.complete is the same requests summed, and is never added.
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    const now = await $.clock.now()
    await touch($, l =>
      count(l, { key: `${e.agentId ?? 'main'}:${e.turnId}:${e.index}`, agentId: e.agentId, model: r.usage?.model ?? e.model, usage: r.usage === null ? null : usageOf(r.usage) }, now),
    )
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const now = await $.clock.now()
    const listed = e.agentId === undefined ? await $.agent.list() : []
    let past: Past | undefined
    await edit($, l => {
      if (e.agentId !== undefined) {
        const a = agentOf(l, e.agentId, now)
        a.status = ENDED[e.reason]
        a.endedAt = now
        const t = total(agentLines(l, a))
        if (a.model !== null) past = { type: a.type, model: short(a.model), result: a.status, usd: t.isPartial ? null : t.usd, tokens: t.usage.input + t.usage.output, at: now }
        return
      }
      const run = l.runs.find(r => r.id === e.turnId)
      if (run !== undefined) {
        run.endedAt = now
        run.reason = e.reason
      }
      // The engine's own word on an agent that ended without a turn.complete here (killed).
      for (const info of listed) {
        const a = l.agents.find(x => x.id === info.id)
        if (a !== undefined && a.status === 'running' && info.status !== 'running') {
          a.status = info.status
          a.endedAt = now
        }
      }
    })
    if (past !== undefined) await $.store.set('results', [...(await pastOf($)), past].slice(-100))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) {
      const id = e.agentId
      const now = await $.clock.now()
      await touch($, l => {
        const a = own(l.agents, agentOf(l, id, now))
        a.lastAction = action(e)
        a.activeAt = now
      })
    }
    return next(e)
  })

  let hasNoted = false
  on('agent.spawn', async ($, e, next) => {
    let asked: Awaited<ReturnType<typeof askJev>> | undefined
    let rec: Rec | undefined
    if (options.mode !== 'off' && !e.fork) {
      if (!hasNoted && (await apiKey($)) === undefined) {
        hasNoted = true
        $.ui.toast('run-ledger: no TYPESAFE_API_KEY set, so Jev model advice is off. Add the key in the plugin settings.')
      }
      try {
        asked = await askJev($, e, Number(options.budgetUsd))
        rec = asked.rec
      } catch (err) {
        rec = { model: null, confidence: null, why: `No recommendation: ${(err as Error).message}`, routed: false, jevUsd: null }
      }
    }
    // Eligible for routing: not a fork, the call named no model, and Jev is sure enough.
    const pick = rec?.model ?? null
    const isRouted = options.mode === 'auto-route' && e.model === undefined && pick !== null && (rec?.confidence ?? 0) >= MIN_CONFIDENCE
    const r = await next(isRouted ? { ...e, model: pick } : e)
    const now = await $.clock.now()
    const origin = next.origin.plugin
    await edit($, l => {
      if (asked !== undefined) count(l, { runVia: e.parentAgentId, model: asked.model, plugin: 'run-ledger', usage: { ...NONE, input: asked.tokens } }, now)
      if (r.agentId === undefined) return
      const plugin = e.provider.plugin !== 'engine' ? e.provider.plugin : origin !== 'engine' ? origin : 'session'
      l.agents = l.agents.filter(a => a.id !== r.agentId)
      l.agents.push({
        id: r.agentId,
        runId: runOf(l, e.parentAgentId, now).id,
        type: e.subagentType,
        task: e.description,
        model: r.model ?? null,
        plugin,
        status: 'running',
        lastAction: '',
        startedAt: now,
        activeAt: now,
        parentId: e.parentAgentId,
        background: e.background,
        rec: rec === undefined ? undefined : { ...rec, routed: isRouted },
      })
    })
    return r
  })

  // A model call another plugin made: the plugin is the source, by the host's own word.
  on('model.complete', async ($, e, next) => {
    const r = await next(e)
    const now = await $.clock.now()
    if (r.deny === undefined) await touch($, l => count(l, { model: e.model, plugin: next.origin.plugin, usage: usageOf(r.value.usage) }, now))
    return r
  })

  on('model.fork', async ($, e, next) => {
    const r = await next(e)
    const now = await $.clock.now()
    const model = await $.session.model()
    if (r.deny === undefined) await touch($, l => count(l, { model, plugin: next.origin.plugin, usage: 'usage' in r.value ? usageOf(r.value.usage) : null }, now))
    return r
  })

  // classify reports no usage, so its cost stays unknown.
  on('model.classify', async ($, e, next) => {
    const r = await next(e)
    const now = await $.clock.now()
    await touch($, l => count(l, { model: 'unknown', plugin: next.origin.plugin, usage: null }, now))
    return r
  })

  // Jev calls other plugins make (dispatch-router). This plugin's own pass through here too
  // and are skipped: agent.spawn already counted them, on the run of the loop that spawned.
  on('http.fetch', async ($, e, next) => {
    const r = await next(e)
    if (e.url !== JEV_URL || next.origin.plugin === 'run-ledger' || r.deny !== undefined || !r.value.ok) return r
    try {
      const json = JSON.parse(r.value.text) as JevReply
      const now = await $.clock.now()
      await touch($, l => count(l, { model: json.model ?? 'jev-latest', plugin: next.origin.plugin, usage: { ...NONE, input: json.usage?.input_tokens ?? 0 } }, now))
    } catch {}
    return r
  })

  // turn.step's result carries no retry count. The engine reports a retry as the notice
  // the transcript shows (a system row, subtype api_error), so those rows are what is counted.
  on('session.append', async ($, e, next) => {
    if (e.door === 'notice' && e.message.type === 'system' && e.message.name === 'api_error') {
      const now = await $.clock.now()
      await touch($, l => {
        const run = own(l.runs, runOf(l, e.agentId, now))
        if (!firstSight(run, `retry:${e.uuid}`)) return
        run.retries += 1
      })
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const l = await read($, ledger)
    const open = await read($, detail)
    await read($, tick)
    const now = await $.clock.now()
    const shown = l.runs.find(r => r.id === open)

    if (shown !== undefined) {
      return (
        <Box flexDirection="column">
          <Text bold wrap="truncate">Run: {shown.task || '(no prompt)'}</Text>
          <Text dimColor wrap="truncate">{money(total(shown.lines))} · retries {shown.retries} · {shown.endedAt === undefined ? 'open' : `${shown.reason} in ${elapsed(shown.endedAt - shown.startedAt)}`}</Text>
          {shown.lines.map(x => (
            <Text wrap="truncate">
              {short(x.model)} · {x.plugin}{x.agentId === undefined ? '' : ` · agent ${l.agents.find(a => a.id === x.agentId)?.type ?? x.agentId}`} · {x.requests} req{x.unreported > 0 ? ` (${x.unreported} no usage)` : ''} · {usageText(x.usage)} · {x.usd === null ? 'unknown' : usd(x.usd)}
            </Text>
          ))}
          {shown.lines.length === 0 && <Text dimColor>No requests counted yet.</Text>}
          <Text dimColor wrap="wrap">{LABEL}</Text>
          <Button key="back" hotkey="b" label="Back" onPress={() => update($, detail, () => null)} />
        </Box>
      )
    }

    const lines = allLines(l)
    const all = total(lines)
    const runs = l.runs.slice(-9).reverse()
    const agents = [...l.agents].sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || b.startedAt - a.startedAt).slice(0, 12)
    const advised = l.agents.filter(a => a.rec !== undefined).slice(-8).reverse()

    return (
      <Box flexDirection="column">
        <Text bold wrap="truncate">Session {money(all)} · {all.requests} requests · retries {retriesOf(l)}</Text>
        <Text wrap="truncate">Tokens: {usageText(all.usage)}</Text>
        {lines.length > 0 && <Text wrap="truncate">By model: {grouped(lines, x => short(x.model))}</Text>}
        {lines.length > 0 && <Text wrap="truncate">By plugin: {grouped(lines, x => x.plugin)}</Text>}
        <Text dimColor wrap="wrap">{LABEL}</Text>

        <Text bold>Runs</Text>
        {runs.length === 0 && <Text dimColor>No runs yet.</Text>}
        {runs.map((r, i) => (
          <Button
            key={`run-${i + 1}`}
            hotkey={String(i + 1)}
            plain
            label={`${money(total(r.lines))} · ${[...new Set(r.lines.map(x => short(x.model)))].join(', ') || 'no requests'} · ${r.task || '(no prompt)'}`.slice(0, Math.max(20, e.props.bodyColumns - 4))}
            onPress={() => update($, detail, () => r.id)}
          />
        ))}

        <Text bold>Subagents</Text>
        {agents.length === 0 && <Text dimColor>None spawned.</Text>}
        {agents.map(a => (
          <Text wrap="truncate" dimColor={a.status !== 'running'}>
            {a.parentId === undefined ? '' : '└ '}{a.status} · {a.type}{a.background ? ' (background)' : ''} · {short(a.model)} · {elapsed((a.endedAt ?? now) - a.startedAt)} · {a.lastAction || a.task || 'no action yet'}
          </Text>
        ))}

        <Text bold>Jev recommendations</Text>
        {advised.length === 0 && <Text dimColor>{options.mode === 'off' ? 'Off.' : 'None yet.'}</Text>}
        {advised.map(a => {
          const rec = a.rec as Rec
          const verdict = rec.model === null || a.model === null ? '' : a.model.includes(rec.model) ? ' (match)' : ' (differs)'
          return (
            <Box flexDirection="column">
              <Text wrap="truncate">
                {a.task || a.type}: recommended {rec.model ?? 'unknown'}{rec.confidence === null ? '' : ` ${pct(rec.confidence)}`} · ran {short(a.model)}{rec.routed ? ' (auto-routed)' : verdict} · {a.status} · {money(total(agentLines(l, a)))} · Jev {rec.jevUsd === null ? 'unknown' : usd(rec.jevUsd)}
              </Text>
              <Text dimColor wrap="truncate">  {rec.why}</Text>
            </Box>
          )
        })}

        <Button key="export" hotkey="e" label="Export JSON" onPress={() => exportLedger($)} />
      </Box>
    )
  })
}
