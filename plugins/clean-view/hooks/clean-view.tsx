import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Checklist, Task } from '../types'

const enabled = atom({ plugin: 'clean-view', key: 'cleanViewEnabled' } as const, true)
const checklist = atom({ plugin: 'clean-view', key: 'checklist' } as const, null as Checklist | null)
const tick = atom({ plugin: 'clean-view', key: 'tick' } as const, 0)

const PLAN_TOOL = 'mcp__clean-view__plan_steps'
const REPORT_TOOL = 'mcp__clean-view__report_progress'
const OPEN_TOOLS = new Set<string>([
  PLAN_TOOL,
  REPORT_TOOL,
  'ToolSearch',
  'TodoWrite',
  'TaskCreate',
  'TaskUpdate',
  'AskUserQuestion',
])
const PLACEHOLDER_STEPS = ['Understand your request', 'Plan the steps']
const CODE_FILE = /\.(tsx?|jsx?|py|json|md|css|html?|sh|ya?ml|rs|go|java|rb|sql|toml|txt)$/i
const NAME_LIMIT = 40

const PLAN_FIRST =
  'Call plan_steps first, with every step of this job as a short plain-English name (2 to 8 steps). Clean View needs the plan before other tools run.'

const PLAN_RULES = `Clean View is on: the user watches a checklist above the prompt, not your tool calls.
- Write every step name in plain English a non-technical person understands. Keep it under 40 characters and start it with a verb, like "Build the pricing section".
- Never put file paths, file names, commands, code or tool names in a step name.
- For every request, even a quick question, call plan_steps first. Load it with ToolSearch if it's deferred. Then call report_progress as real progress happens, and with 100 the moment a step finishes.
- If the session has TodoWrite or TaskCreate, you can use its to-do list as the plan instead.`

const NAME_PROMPT =
  'Write a name for this job in 2 to 6 plain English words that starts with a verb. Reply with the name only.'

// Module memory: a reload starts these over
let jobSeq = 0
let isRunning = false
let failures = 0
let apiError: string | null = null
let ticker: { cancel: () => void } | null = null

export function cleanName(raw: string): string {
  const words = raw
    .replace(/`[^`]*`/g, ' ')
    .split(/\s+/)
    .filter(word => word !== '' && !word.includes('/') && !CODE_FILE.test(word))
  const text = words.join(' ')
  if (text === '') return 'Working on it'

  const capital = text.charAt(0).toUpperCase() + text.slice(1)
  if (capital.length <= NAME_LIMIT) return capital

  const cut = capital.slice(0, NAME_LIMIT - 1)
  const at = cut.lastIndexOf(' ')
  return `${(at > 0 ? cut.slice(0, at) : cut).trimEnd()}…`
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function planTasks(names: readonly string[]): Task[] {
  return names.map((name, index) => ({
    id: `step-${index + 1}`,
    name: cleanName(name),
    status: index === 0 ? 'active' : 'upcoming',
    percent: 0,
    hasReported: false,
  }))
}

function apiErrorSentence(error: string, details: string | undefined): string {
  const text = details ?? ''
  if (error === 'rate_limit') return 'you hit your usage limit, try again a little later'
  if (error === 'overloaded' || error === 'server_error') return "Claude's servers are busy, try again in a minute"
  if (error === 'authentication_failed') return 'type /login'
  if (/too long|context/i.test(text)) return 'type /compact and try again'
  if (/network|ECONN|ENOTFOUND|fetch failed|socket|offline/i.test(text)) return 'the internet connection dropped'
  return 'Claude ran into a problem, try again in a moment'
}

function meter(task: Task, frame: number): string {
  if (task.status === 'done') return '█'.repeat(10)
  if (task.status === 'upcoming') return '░'.repeat(10)
  if (!task.hasReported) {
    return Array.from({ length: 10 }, (_, cell) => (((cell - frame) % 10) + 10) % 10 < 3 ? '█' : '░').join('')
  }
  const filled = Math.round(task.percent / 10)
  return '█'.repeat(filled) + '░'.repeat(10 - filled)
}

function fit(name: string, width: number): string {
  return name.length > width ? `${name.slice(0, width - 1)}…` : name.padEnd(width)
}

function headline(list: Checklist, elapsed: string): string {
  switch (list.phase) {
    case 'working':
      return `${list.title} · ${elapsed}`
    case 'needs-you':
      return `Needs you · ${list.needsYouReason}`
    case 'stuck':
      return `⚠ Stuck: ${list.stuckReason}`
    case 'stopped':
      return `■ Stopped · ${list.title} · you pressed Esc`
    case 'done':
      return `✓ All done · ${list.title} · took ${elapsed}`
  }
}

async function setPatch($: EngineInterface, patch: (list: Checklist) => Checklist) {
  await update($, checklist, list => (list === null ? list : patch(list)))
  syncTicker($, (await read($, checklist))?.phase)
}

function syncTicker($: EngineInterface, phase: Checklist['phase'] | undefined) {
  const isLive = phase === 'working' || phase === 'needs-you'
  if (isLive && ticker === null) {
    ticker = $.clock.every(250, () => {
      void update($, tick, frame => frame + 1)
    })
  }
  if (!isLive && ticker !== null) {
    ticker.cancel()
    ticker = null
  }
}

async function setEnabled($: EngineInterface, value: boolean) {
  await update($, enabled, () => value)
  await $.store.set('cleanViewEnabled', value)
  $.ui.toast(value ? 'Clean View is on' : 'Clean View is off')
}

async function nameJob($: EngineInterface, seq: number, prompt: string) {
  const reply = await $.model.complete({ model: 'haiku', effort: 'low', maxTokens: 20, system: NAME_PROMPT, prompt })
  if (seq !== jobSeq || !reply.isAnswered) return
  await setPatch($, list => ({ ...list, title: cleanName(reply.text) }))
}

export function registerCleanView(on: On): void {
  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('cleanViewEnabled')
    await update($, enabled, () => saved !== false)

    await $.tool.register({
      name: 'plan_steps',
      description:
        'Lay out every step of the current job up front: 2 to 8 short plain-English names, in order. The first step starts right away.',
      inputSchema: {
        type: 'object',
        properties: { steps: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 8 } },
        required: ['steps'],
      },
    })
    await $.tool.register({
      name: 'report_progress',
      description: 'Report progress on the current step: the step name and a percent from 0 to 100.',
      inputSchema: {
        type: 'object',
        properties: { task: { type: 'string' }, percent: { type: 'number' } },
        required: ['task', 'percent'],
      },
    })
    await $.command.register({ name: 'simple', description: 'Turn Clean View on or off', argumentHint: 'on|off' })

    return next(e)
  })

  on('command.run', { command: 'simple' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg !== '' && arg !== 'on' && arg !== 'off') return { text: 'Use /simple on or /simple off.' }

    const value = arg === '' ? !(await read($, enabled)) : arg === 'on'
    await setEnabled($, value)

    return { text: value ? 'Clean View is on.' : 'Clean View is off.' }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!(await read($, enabled))) return composed

    return {
      sections: [...composed.sections, { id: 'clean-view:plan', text: PLAN_RULES, scope: 'session' as const }],
    }
  })

  on('prompt.submit', async ($, e, next) => {
    await setPatch($, list => (list.phase === 'needs-you' ? { ...list, phase: 'working', needsYouReason: null } : list))

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    const text = e.text.trim()
    if (!isRunning && text !== '' && !text.startsWith('/')) {
      isRunning = true
      jobSeq += 1
      failures = 0
      apiError = null
      const seq = jobSeq
      const startedAt = await $.clock.now()

      await update($, checklist, (): Checklist => ({
        title: 'Working on your request',
        phase: 'working',
        tasks: planTasks(PLACEHOLDER_STEPS),
        hasRealPlan: false,
        needsYouReason: null,
        stuckReason: null,
        startedAt,
        finishedAt: null,
        isCollapsed: false,
      }))
      syncTicker($, 'working')
      nameJob($, seq, text).catch(() => undefined)
    }

    return next(e)
  })

  // Gate for every tool but the open ones, and the to-do tools that can stand in for a plan
  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined || !(await read($, enabled))) return next(e)

    const list = await read($, checklist)
    if (list !== null && !list.hasRealPlan && !OPEN_TOOLS.has(e.tool)) {
      return { deny: PLAN_FIRST }
    }

    if (e.tool === 'AskUserQuestion') {
      await setPatch($, job => ({ ...job, phase: 'needs-you', needsYouReason: 'Claude is waiting for your answer' }))
    } else if (!OPEN_TOOLS.has(e.tool)) {
      await setPatch($, job => (job.phase === 'needs-you' ? { ...job, phase: 'working', needsYouReason: null } : job))
    }

    if (e.tool === 'TodoWrite') {
      const todos = e.todos.map((todo, index) => ({
        id: `todo-${index + 1}`,
        name: cleanName(todo.content),
        status: todo.status === 'completed' ? 'done' : todo.status === 'in_progress' ? 'active' : 'upcoming',
        percent: todo.status === 'completed' ? 100 : 0,
        hasReported: false,
      })) as Task[]
      await setPatch($, job => ({ ...job, tasks: todos, hasRealPlan: todos.length > 0 }))
    }

    if (e.tool === 'TaskCreate') {
      await setPatch($, job => {
        const id = String(job.tasks.length + 1)
        const task: Task = { id, name: cleanName(e.subject), status: 'upcoming', percent: 0, hasReported: false }
        return { ...job, tasks: [...job.tasks, task], hasRealPlan: true }
      })
    }

    if (e.tool === 'TaskUpdate') {
      const { taskId, status } = e
      await setPatch($, job => ({
        ...job,
        hasRealPlan: true,
        tasks: job.tasks.map(task => {
          if (task.id !== String(taskId) || status === undefined) return task
          if (status === 'completed') return { ...task, status: 'done', percent: 100 }
          if (status === 'in_progress') return { ...task, status: 'active', percent: 0, hasReported: false }
          return { ...task, status: 'upcoming', percent: 0, hasReported: false }
        }),
      }))
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: PLAN_TOOL }, async ($, e) => {
    const steps = (e.input as { steps?: unknown }).steps
    if (!Array.isArray(steps) || steps.length < 2 || steps.length > 8 || !steps.every(s => typeof s === 'string')) {
      return { result: 'Give 2 to 8 short step names.' }
    }

    const startedAt = await $.clock.now()
    const list = await read($, checklist)
    const base: Checklist = list ?? {
      title: 'Working on your request',
      phase: 'working',
      tasks: [],
      hasRealPlan: false,
      needsYouReason: null,
      stuckReason: null,
      startedAt,
      finishedAt: null,
      isCollapsed: false,
    }
    await update($, checklist, () => ({ ...base, tasks: planTasks(steps), hasRealPlan: true }))
    syncTicker($, 'working')

    return { result: `Planned ${steps.length} steps. The first one has started.` }
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: REPORT_TOOL }, async ($, e) => {
    const { task, percent } = e.input as { task?: unknown; percent?: unknown }
    const list = await read($, checklist)
    if (list === null) return { result: 'No plan yet. Call plan_steps first.' }
    if (typeof task !== 'string' || typeof percent !== 'number' || !Number.isFinite(percent)) {
      return { result: 'Give a step name and a percent from 0 to 100.' }
    }

    const name = cleanName(task).toLowerCase()
    const index = list.tasks.findIndex(one => one.name.toLowerCase() === name)
    if (index < 0) {
      return { result: `No planned step is named "${task}". Planned steps: ${list.tasks.map(one => one.name).join('; ')}.` }
    }

    const value = Math.min(100, Math.max(0, Math.round(percent)))
    await setPatch($, job => ({
      ...job,
      tasks: job.tasks.map((one, i) => {
        if (i < index) return { ...one, status: 'done', percent: 100, hasReported: true }
        if (i === index) {
          return value >= 100
            ? { ...one, status: 'done', percent: 100, hasReported: true }
            : { ...one, status: 'active', percent: value, hasReported: true }
        }
        if (i === index + 1 && value >= 100) return { ...one, status: 'active', percent: 0, hasReported: false }
        return { ...one, status: 'upcoming', percent: 0, hasReported: false }
      }),
    }))

    return { result: `Recorded ${value}% on "${list.tasks[index]!.name}".` }
  }).catch(($, e, next) => next(e))

  on('classic.PostToolUse', async ($, e, next) => {
    failures = 0
    await setPatch($, job => (job.phase === 'stuck' ? { ...job, phase: 'working', stuckReason: null } : job))

    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.PostToolUseFailure', async ($, e, next) => {
    failures += 1
    if (failures >= 3) {
      await setPatch($, job => ({
        ...job,
        phase: 'stuck',
        stuckReason: 'a step keeps failing, Claude is trying another way',
      }))
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.PermissionDenied', async ($, e, next) => {
    await setPatch($, job => ({
      ...job,
      phase: 'stuck',
      stuckReason: 'you said no to a step, so Claude paused',
    }))

    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.Notification', async ($, e, next) => {
    await setPatch($, job => ({ ...job, phase: 'needs-you', needsYouReason: 'Claude needs your OK to continue' }))

    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.StopFailure', async ($, e, next) => {
    apiError = apiErrorSentence(e.error, e.error_details)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    isRunning = false
    const list = await read($, checklist)
    if (list !== null) {
      const now = await $.clock.now()
      const seq = jobSeq

      if (e.reason === 'aborted') {
        await setPatch($, job => ({ ...job, phase: 'stopped', needsYouReason: null, finishedAt: now }))
      } else if (e.reason === 'refusal') {
        await setPatch($, job => ({ ...job, phase: 'stuck', stuckReason: "Claude couldn't help with that request", finishedAt: now }))
      } else if (e.reason === 'error') {
        await setPatch($, job => ({
          ...job,
          phase: 'stuck',
          stuckReason: apiError ?? 'Claude ran into a problem, try again in a moment',
          finishedAt: now,
        }))
      } else if (!list.hasRealPlan || list.tasks.every(task => task.status === 'done')) {
        await setPatch($, job => ({
          ...job,
          phase: 'done',
          tasks: job.tasks.map(task => ({ ...task, status: 'done', percent: 100 })),
          finishedAt: now,
        }))
        $.clock.after(5000, () => {
          if (seq === jobSeq) void setPatch($, job => ({ ...job, isCollapsed: true }))
        })
      } else {
        await setPatch($, job => ({ ...job, phase: 'needs-you', needsYouReason: 'Claude is waiting for your reply' }))
      }
    }
    apiError = null

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const isOn = await read($, enabled)
    const list = await read($, checklist)
    const toggle = (
      <Button
        key="clean-view"
        label={isOn ? '● Clean View: ON' : '○ Clean View: OFF'}
        onPress={() => setEnabled($, !isOn)}
      />
    )
    if (!isOn || list === null) {
      return (
        <Box flexDirection="row" justifyContent="flex-end">
          {toggle}
        </Box>
      )
    }

    const now = await $.clock.now()
    const frame = await read($, tick)
    const elapsed = formatDuration((list.finishedAt ?? now) - list.startedAt)
    const isNeedsYou = list.phase === 'needs-you'
    const width = Math.max(12, e.props.bodyColumns - 26)
    const firstUpcoming = list.tasks.findIndex(task => task.status === 'upcoming')
    const isCollapsed = list.phase === 'done' && list.isCollapsed

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text color={isNeedsYou ? 'yellow' : undefined} bold={isNeedsYou}>
            {headline(list, elapsed)}
          </Text>
          {toggle}
        </Box>
        {isCollapsed
          ? null
          : list.tasks.map((task, index) => {
              const marker = task.status === 'done' ? '✓' : task.status === 'active' ? (isNeedsYou ? '‖' : '▶') : '○'
              const label =
                task.status === 'done'
                  ? 'Done'
                  : task.status === 'active'
                    ? task.hasReported
                      ? `${task.percent}%`
                      : 'Working'
                    : index === firstUpcoming
                      ? 'Next'
                      : 'Up next'
              return (
                <Box key={task.id} flexDirection="row">
                  <Text
                    bold={task.status === 'active'}
                    dimColor={task.status !== 'active'}
                    color={task.status === 'done' ? 'green' : undefined}
                  >
                    {`${marker} ${fit(task.name, width)}`}
                  </Text>
                  <Text dimColor>{`  ${meter(task, frame)}  `}</Text>
                  <Text dimColor={task.status !== 'active'}>{label}</Text>
                </Box>
              )
            })}
      </Box>
    )
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!(await read($, enabled))) return next(e)

    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!(await read($, enabled))) return next(e)

    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (!(await read($, enabled))) return next(e)

    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => {
    if (!(await read($, enabled))) return next(e)

    const { Box } = $.ui.resolve(e)
    return <Box />
  })
}
