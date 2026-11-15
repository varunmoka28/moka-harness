import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Idea } from '../types'

const ideas = atom({ plugin: 'idea-shelf', key: 'ideas' } as const, [])

const KEY = 'ideas'

// One global shelf: the same list shows in every project.
async function save($: EngineInterface, fn: (list: Idea[]) => Idea[]) {
  const list = fn(await read($, ideas))
  await update($, ideas, () => list)
  await $.store.set(KEY, list)
  $.ui.status(list.length ? `💡 ${list.length} shelved` : undefined)
}

async function send($: EngineInterface, idea: Idea) {
  const { text } = await $.prompt.read()
  await $.prompt.fill(text.trim() ? { text: `\n${idea.text}`, mode: 'append' } : { text: idea.text, mode: 'replace' })
  await save($, list => list.filter(i => i.id !== idea.id))
}

// First sentence, cut at 60 characters, so a row stays on one line; Send still fills the full text.
export function title(text: string): string {
  const first = text.split(/(?<=[.!?])\s/)[0]!.trim()
  return first.length > 60 ? first.slice(0, 59).trimEnd() + '…' : first
}

const DAY = 86_400_000

// Today / This week / Older, newest first inside each; ideas without `at` (pre-0.3.0) count as Older.
export function groupByAge(list: Idea[], now: number): [string, Idea[]][] {
  const age = (i: Idea) => (i.at ? now - Date.parse(i.at) : Infinity)
  const sorted = [...list].sort((a, b) => age(a) - age(b))
  const buckets: [string, (i: Idea) => boolean][] = [
    ['Today', i => age(i) < DAY],
    ['This week', i => age(i) < 7 * DAY],
    ['Older', () => true],
  ]
  const out: [string, Idea[]][] = []
  let rest = sorted
  for (const [label, fits] of buckets) {
    const hit = rest.filter(fits)
    rest = rest.filter(i => !fits(i))
    if (hit.length) out.push([label, hit])
  }
  return out
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Pre-0.2.0 kept one list per project root (absolute path keys); fold them into the global list once.
    const legacy = (await $.store.keys()).filter(k => k.startsWith('/'))
    const stored = ((await $.store.get(KEY)) ?? []) as Idea[]
    for (const k of legacy) {
      stored.push(...(((await $.store.get(k)) ?? []) as Idea[]))
      await $.store.delete(k)
    }
    if (legacy.length) await $.store.set(KEY, stored)
    await update($, ideas, () => stored)
    $.ui.status(stored.length ? `💡 ${stored.length} shelved` : undefined)
    await $.command.register({ name: 'idea', description: 'Shelve an idea for later without interrupting Claude', argumentHint: '<text>' })
    await $.command.register({ name: 'ideas', description: 'List the shelved ideas' })
    return next(e)
  })

  on('command.run', { command: 'idea' }, async ($, e) => {
    const text = e.args.trim()
    if (!text) return { text: 'Usage: /idea <text>' }
    await save($, list => [...list, { id: crypto.randomUUID(), text, at: new Date().toISOString() }])
    return { text: `Shelved: ${text}` }
  })

  on('command.run', { command: 'ideas' }, async $ => {
    const list = await read($, ideas)
    if (!list.length) return { text: 'Nothing shelved.' }
    const rows = groupByAge(list, Date.now()).flatMap(([label, items]) => [label, ...items.map(i => `  💡 ${i.text}`)])
    return { text: [`${list.length} shelved`, ...rows].join('\n') }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, ideas)
    if (!list.length) return below
    const groups = groupByAge(list, Date.now())
    const shelf = (
      <Box flexDirection="column">
        {groups.map(([label, items]) => (
          <Box key={label} flexDirection="column">
            <Text dimColor>{label}</Text>
            {items.map(idea => (
              <Box key={idea.id}>
                <Text>  💡 {title(idea.text)} </Text>
                <Button key={`send-${idea.id}`} label="Send" onPress={() => send($, idea)} />
                <Button key={`discard-${idea.id}`} label="Discard" onPress={() => save($, l => l.filter(i => i.id !== idea.id))} />
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    )
    return below ? <Box flexDirection="column">{below}{shelf}</Box> : shelf
  })
}
