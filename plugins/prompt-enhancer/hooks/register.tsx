import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Recent, Status } from '../types'

const original = atom({ plugin: 'prompt-enhancer', key: 'original' } as const, null)
const status = atom({ plugin: 'prompt-enhancer', key: 'status' } as const, { kind: 'idle' })
const recent = atom({ plugin: 'prompt-enhancer', key: 'recent' } as const, { prompts: [], answer: '' })

// ponytail: rules over this many chars are cut, raise if long rule files lose their tail
const RULES_CAP = 15000
// ponytail: last 3 prompts + last reply only, older context is invisible to the rewrite
const KEEP_PROMPTS = 3
const ANSWER_CAP = 3000

const SYSTEM = `You rewrite a rough request into a clear prompt for Claude Code. The user reads and edits your output before sending it.

Use the recent conversation to resolve what the request refers to ("that", "it", "the second one", "why does it..."). You have no tools, but Claude Code can search files and memory. If the request names something neither the conversation nor the rules explain, keep that name as written for Claude Code to find; do not ask the user where it is. Never invent a different task.

Keep the user's intent and scope. Do not add features they did not ask for. Use the project rules to make the task specific (real paths, commands, conventions), and follow any rule that applies to this kind of task.

Output only the rewritten prompt, in this shape:
1. The task in one to four plain sentences.
2. "Skills:" followed by the skills from the given list that clearly fit this task, with a few words on why. A high router rank alone is not enough. Leave the line out if none fit. Never name a skill that is not in the list.
3. "Ask me first:" followed by one to three decisions that are the user's to make and would change the result. Never ask about anything Claude Code could look up. Leave it out if there are none.
4. "Done means:" followed by one line saying how to verify the work, fitted to the task: a change ends in a build, test or visible behaviour; a review or explanation ends in what the answer must contain. Never invent a command or value the input does not give.

Write plainly. No em dashes, no filler, no headings beyond those labels, no preamble.`

async function projectRules($: EngineInterface): Promise<string> {
  const parts: string[] = []
  const found = await $.fs.ancestors({ names: ['CLAUDE.md', 'AGENTS.md'] }).catch(() => [])
  for (const f of found) parts.push(`## ${f.dir}/${f.name}\n${f.content}`)
  const entries = await $.fs.list('.claude/rules').catch(() => [])
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.md')) continue
    const text = await $.fs.read(`.claude/rules/${entry.name}`).catch(() => '')
    if (text) parts.push(`## .claude/rules/${entry.name}\n${text}`)
  }
  return parts.join('\n\n').slice(0, RULES_CAP)
}

// Runs the router bundled in this plugin (hooks/jev-skill-router.py) with the same input a UserPromptSubmit hook gets.
async function apiKey($: EngineInterface): Promise<string | undefined> {
  return (await $.env.get('CLAUDE_PLUGIN_OPTION_TYPESAFE_API_KEY')) || (await $.env.get('TYPESAFE_API_KEY')) || undefined
}

async function jevSkills($: EngineInterface, prompt: string, cwd: string, key: string): Promise<string[]> {
  const root = await $.env.get('CLAUDE_PLUGIN_ROOT')
  if (!root) return []
  const r = await $.process
    .run(['python3', `${root}/hooks/jev-skill-router.py`], {
      stdin: JSON.stringify({ prompt, cwd }),
      env: { TYPESAFE_API_KEY: key },
      timeoutMs: 20000,
    })
    .catch(() => null)
  if (!r || r.exitCode !== 0 || !r.stdout.trim()) return []
  let ctx = ''
  try {
    ctx = JSON.parse(r.stdout).hookSpecificOutput?.additionalContext ?? ''
  } catch {
    return []
  }
  return ctx.split('\n').filter(line => line.startsWith('- `'))
}

async function setStatus($: EngineInterface, s: Status) {
  await update($, status, () => s)
}

// Says the key is missing once per session.
let hasNoted = false

async function enhance($: EngineInterface) {
  const { text } = await $.prompt.read()
  const draft = text.trim()
  if (!draft) {
    $.ui.toast('Type a prompt first')
    return
  }
  const key = await apiKey($)
  if (key === undefined) {
    if (!hasNoted) {
      hasNoted = true
      $.ui.toast('prompt-enhancer: no TYPESAFE_API_KEY set, so Enhance does nothing. Add the key in the plugin settings.')
    }
    return
  }
  await setStatus($, { kind: 'working' })
  try {
    await rewrite($, text, draft, key)
  } catch (error) {
    await setStatus($, { kind: 'error', message: String((error as Error)?.message ?? error).slice(0, 120) })
  }
}

async function rewrite($: EngineInterface, text: string, draft: string, key: string) {
  const cwd = await $.session.cwd()
  const [rules, skills] = await Promise.all([projectRules($), jevSkills($, draft, cwd, key)])
  const { prompts, answer } = await read($, recent)
  const convo = [...prompts.map(p => `User: ${p}`), answer && `Claude's last reply: ${answer}`].filter(Boolean).join('\n\n')
  const prompt = [
    `Rough request:\n${draft}`,
    `Project: ${cwd}`,
    `Recent conversation:\n${convo || '(none)'}`,
    `Project rules:\n${rules || '(none found)'}`,
    `Skills ranked relevant by the router:\n${skills.join('\n') || '(none)'}`,
  ].join('\n\n')
  const r = await $.model.complete({ model: 'haiku', system: SYSTEM, prompt, maxTokens: 1200 })
  if (!r.isAnswered) {
    await setStatus($, { kind: 'error', message: r.reason })
    return
  }
  if ((await $.prompt.read()).text !== text) {
    await setStatus($, { kind: 'error', message: 'prompt changed while enhancing, left as you typed it' })
    return
  }
  await update($, original, prev => prev ?? text)
  await $.prompt.fill({ text: r.text.trim(), mode: 'replace' })
  await setStatus($, { kind: 'done', skills: skills.map(s => s.match(/`([^`]+)`/)?.[1] ?? '').filter(Boolean) })
}

async function undo($: EngineInterface) {
  const before = await read($, original)
  if (before === null) return
  await $.prompt.fill({ text: before, mode: 'replace' })
  await update($, original, () => null)
  await setStatus($, { kind: 'idle' })
}

async function send($: EngineInterface) {
  const { text } = await $.prompt.read()
  if (!text.trim()) return
  await $.prompt.fill({ text: '', mode: 'replace' })
  await update($, original, () => null)
  await setStatus($, { kind: 'idle' })
  void $.prompt.submit({ text })
}

export const register: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    const text = e.text.trim()
    if (text && !text.startsWith('<')) {
      await update($, recent, (r: Recent) => ({ ...r, prompts: [...r.prompts, text].slice(-KEEP_PROMPTS) }))
    }
    if (e.origin?.kind !== 'plugin') {
      await update($, original, () => null)
      await setStatus($, { kind: 'idle' })
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId && e.answer) {
      await update($, recent, (r: Recent) => ({ ...r, answer: e.answer.slice(-ANSWER_CAP) }))
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey || e.props.isWorking) return below
    const { Box, Button, Text } = $.ui.resolve(e)
    const s = await read($, status)
    const canUndo = (await read($, original)) !== null
    const note =
      s.kind === 'working' ? 'enhancing...'
      : s.kind === 'error' ? `failed: ${s.message}`
      : s.kind === 'done' ? (s.skills.length ? `skills: ${s.skills.join(', ')}` : 'enhanced')
      : ''

    const band = (
      <Box>
        <Button key="enhance" label="Enhance" hotkey="e" onPress={() => enhance($)} />
        {canUndo ? <Button key="undo" label="Undo" hotkey="u" onPress={() => undo($)} /> : null}
        <Button key="send" label="Send" hotkey="s" onPress={() => send($)} />
        <Text dimColor> {note || 'ctrl+x tab, then e'}</Text>
      </Box>
    )
    return below ? <Box flexDirection="column">{band}{below}</Box> : band
  })
}
