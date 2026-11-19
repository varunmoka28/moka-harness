import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

// on is read by other plugins (cache-clock, collision-guard): true in both modes, since nobody is at the keyboard either way.
const on = atom({ plugin: 'unattended', key: 'on' } as const, false)
const route = atom({ plugin: 'unattended', key: 'route' } as const, false)

// What the model reads in place of the tool's result.
const NO_QUESTIONS =
  'Unattended mode is on: nobody is at the keyboard to answer. Do not ask again. Pick the most sensible option yourself, say in your reply which one you picked and why, and carry on.'

const NO_TASK_FILE = 'Route mode is on, but CLAUDE_TASK_FILE is not set, so the question cannot go to the orchestrator.'

const routed = (path: string) =>
  `Route mode is on: your question was written to ${path} as STATUS: blocked, and the orchestrator will answer it there. Do not ask again. Carry on with any part of the task that does not depend on the answer; if nothing is left, stop and wait.`

// ponytail: plan mode ends in an approval dialog a hook cannot answer, so the only
// safe move is to stop the model entering it. A session launched in plan mode still stops there.
const NO_PLAN_MODE =
  'Unattended mode is on: plan mode ends in an approval prompt nobody will answer. Write the plan in your reply instead and go straight on to doing it.'

type Question = { question: string; options?: readonly { label: string }[] }

const entry = (questions: readonly Question[]) =>
  'STATUS: blocked\n' +
  questions.map(q => `QUESTION: ${q.question} Options: ${(q.options ?? []).map(o => o.label).join(' | ')}\n`).join('')

export const register: Register = hook => {
  hook('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'unattended',
      description: 'Stop this session asking you questions: /unattended on, /unattended route, /unattended off, or /unattended to flip it',
      immediate: true,
    })

    const env = await $.env.get('CLAUDE_UNATTENDED')
    if (env === 'route') await update($, route, () => true)
    if (env === '1' || env === 'route') await update($, on, () => true)

    return next(e)
  })

  hook('command.run', { command: 'unattended' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg !== '' && arg !== 'on' && arg !== 'off' && arg !== 'route') {
      return { text: 'Usage: /unattended on, /unattended route, /unattended off, or /unattended to flip it.' }
    }

    // Decide inside the update so two quick commands cannot both act on the same old value.
    let isOn = false
    await update($, on, current => {
      isOn = arg === 'on' || arg === 'route' || (arg === '' && !current)
      return isOn
    })
    await update($, route, () => arg === 'route')

    if (!isOn) return { text: 'Unattended mode off.' }
    if (arg !== 'route') return { text: 'Unattended mode on: questions and plan mode are refused.' }
    const task = await $.env.get('CLAUDE_TASK_FILE')
    return {
      text: task
        ? `Unattended route mode on: questions go to ${task} as STATUS: blocked; plan mode is refused.`
        : `Unattended route mode on. ${NO_TASK_FILE} Questions will be refused with a note to pick and carry on.`,
    }
  })

  // If the switch cannot be read, let the call through rather than block it.
  hook('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    if (!(await read($, on).catch(() => false))) return next(e)
    if (!(await read($, route).catch(() => false))) return { deny: NO_QUESTIONS }

    const task = await $.env.get('CLAUDE_TASK_FILE')
    if (!task) return { deny: `${NO_TASK_FILE} ${NO_QUESTIONS}` }

    // ponytail: no append call in the mod API, so read whole and write back; task files are small.
    const unwritable = { deny: `Route mode is on, but ${task} could not be written. ${NO_QUESTIONS}` }
    let old = ''
    try {
      old = await $.fs.read(task)
    } catch {
      // A file that exists but cannot be read must not be overwritten with only the blocked lines.
      if (await $.fs.exists(task).catch(() => true)) return unwritable
    }
    try {
      await $.fs.write(task, (old === '' ? '' : old.replace(/\s*$/, '\n\n')) + entry(e.questions))
    } catch {
      return unwritable
    }
    return { deny: routed(task) }
  })

  hook('tool.call', { tool: 'EnterPlanMode' }, async ($, e, next) => {
    const isOn = await read($, on).catch(() => false)
    return isOn ? { deny: NO_PLAN_MODE } : next(e)
  })
}
