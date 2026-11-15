import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const on = atom({ plugin: 'unattended', key: 'on' } as const, false)

// What the model reads in place of the tool's result.
const NO_QUESTIONS =
  'Unattended mode is on: nobody is at the keyboard to answer. Do not ask again. Pick the most sensible option yourself, say in your reply which one you picked and why, and carry on.'

// ponytail: plan mode ends in an approval dialog a hook cannot answer, so the only
// safe move is to stop the model entering it. A session launched in plan mode still stops there.
const NO_PLAN_MODE =
  'Unattended mode is on: plan mode ends in an approval prompt nobody will answer. Write the plan in your reply instead and go straight on to doing it.'

export const register: Register = hook => {
  hook('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'unattended',
      description: 'Stop this session asking you questions: /unattended on, /unattended off, or /unattended to flip it',
      immediate: true,
    })

    if ((await $.env.get('CLAUDE_UNATTENDED')) === '1') {
      await update($, on, () => true)
    }

    return next(e)
  })

  hook('command.run', { command: 'unattended' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg !== '' && arg !== 'on' && arg !== 'off') {
      return { text: 'Usage: /unattended on, /unattended off, or /unattended to flip it.' }
    }

    // Decide inside the update so two quick commands cannot both act on the same old value.
    let isOn = false
    await update($, on, current => {
      isOn = arg === 'on' || (arg !== 'off' && !current)
      return isOn
    })

    return { text: isOn ? 'Unattended mode on: questions and plan mode are refused.' : 'Unattended mode off.' }
  })

  // If the switch cannot be read, let the call through rather than block it.
  hook('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const isOn = await read($, on).catch(() => false)
    return isOn ? { deny: NO_QUESTIONS } : next(e)
  })

  hook('tool.call', { tool: 'EnterPlanMode' }, async ($, e, next) => {
    const isOn = await read($, on).catch(() => false)
    return isOn ? { deny: NO_PLAN_MODE } : next(e)
  })
}
