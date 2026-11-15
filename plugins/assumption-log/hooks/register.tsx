import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Assumption, Log } from '../types'

const PANE = 'assumption-log'
const TOOL = 'mcp__assumption-log__note_assumption'
const SHOWN = 5
const KEPT = 30
const EMPTY: Log = { notes: [], next: 1 }

// Held in memory for this conversation only: nothing is written to disk.
const log = atom({ plugin: 'assumption-log', key: 'log' } as const, EMPTY)

// What Claude is told, as a section of its system prompt.
const GUIDE = [
  '# Writing down your assumptions',
  'The user watches a live panel of the guesses you make about what they want.',
  `When you make a judgment call the user did not state, and it changes what you do next, call the ${TOOL} tool once, before you act on it. If the tool is not loaded yet, load it by that exact name first.`,
  'Log: which of two readings of the request you took, what you treated as in or out of scope, what you chose to keep or delete, what you took "done" to mean.',
  'Do not log facts you checked, routine steps, or anything the user said outright.',
  'One plain sentence each. If a later finding overturns an earlier assumption, call the tool again with `replaces` set to its id, such as A3.',
  'A small task may have none.',
].join('\n')

const clean = (value: unknown): string => `${value ?? ''}`.replace(/\s+/g, ' ').trim().slice(0, 240)

// "A3", "a3" and "3" all name assumption 3; anything else names nothing.
const idOf = (value: string): number | null => {
  const match = /^a?(\d+)$/i.exec(value)

  return match ? Number(match[1]) : null
}

const whole = (value: Log): Log => ({ ...EMPTY, ...value })

// Stores one assumption and answers Claude with the id a later one can replace.
const record = async ($: EngineInterface, input: Record<string, unknown>, isSubagent: boolean): Promise<string | null> => {
  const text = clean(input.assumption)

  if (text === '') {
    return null
  }

  const at = await $.clock.now()
  const named = clean(input.replaces)
  const target = idOf(named)
  let replaced = false

  const after = whole(
    await update($, log, raw => {
      const s = whole(raw)
      const id = s.next
      const isTarget = (one: Assumption): boolean => one.id === target && one.id < id && one.status !== 'replaced'
      replaced = s.notes.some(isTarget)
      const added: Assumption = {
        id,
        text,
        basis: clean(input.basis),
        affects: clean(input.affects),
        at,
        isSubagent,
        status: 'open',
        replacedBy: null,
      }

      return {
        next: id + 1,
        notes: [...s.notes.map(one => (isTarget(one) ? { ...one, status: 'replaced' as const, replacedBy: id } : one)), added].slice(-KEPT),
      }
    }),
  )
  const id = after.next - 1

  $.ui.toast(`Assumed: ${text.slice(0, 90)} (/assumptions to see all)`)

  if (named === '') {
    return `Noted as A${id}. The user can see it.`
  }

  return replaced
    ? `Noted as A${id}, replacing A${target}. The user can see it.`
    : `Noted as A${id}. "${named}" matches no earlier assumption that is still standing, so nothing was replaced.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'assumptions',
      description: 'Show the guesses Claude has made about what you want. /assumptions close hides them, /assumptions clear empties the list.',
    })
    await $.tool.register({
      name: 'note_assumption',
      description:
        'Record one assumption you are making about what the user wants, before acting on it. The user sees it at once and can reject it. Use it for judgment calls the user did not state; not for verified facts or routine steps.',
      inputSchema: {
        type: 'object',
        properties: {
          assumption: { type: 'string', description: 'The assumption, as one plain sentence.' },
          basis: { type: 'string', description: 'What led you to it, in a few words.' },
          affects: { type: 'string', description: 'What it changes: the files, behaviour or scope that would differ if it is wrong.' },
          replaces: { type: 'string', description: 'The id of an earlier assumption this one overturns, such as A3. Leave out otherwise.' },
        },
        required: ['assumption', 'basis', 'affects'],
        additionalProperties: false,
      },
    })

    return next(e)
  })

  // /clear, /resume and exit end the conversation Claude's earlier ids belonged to.
  on('session.end', async ($, e, next) => {
    await update($, log, () => EMPTY)

    return next(e)
  })

  on('command.run', { command: 'assumptions' }, async ($, e) => {
    const word = `${e.args ?? ''}`.trim().toLowerCase()

    if (word === 'close') {
      await $.ui.close({ id: PANE })

      return { text: 'Assumptions panel closed.' }
    }

    if (word === 'clear') {
      // The counter stays, so an id Claude already used is never handed out twice.
      await update($, log, raw => ({ ...whole(raw), notes: [] }))

      return { text: 'Assumption list cleared.' }
    }

    await $.ui.open({ id: PANE, title: 'Assumptions', closeOnEscape: true })

    return { text: 'Assumptions panel opened. /assumptions close hides it.' }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    return { sections: [...composed.sections, { id: 'assumption-log:guide', text: GUIDE, scope: 'session' as const }] }
  })

  on('tool.call', async ($, e, next) => {
    const called: string = e.tool

    if (called !== TOOL) {
      return next(e)
    }

    // A failure here must not block the tool call.
    const noted = await record($, e as unknown as Record<string, unknown>, e.agentId !== undefined).catch(() => undefined)

    if (noted === undefined) {
      return next(e)
    }

    return (noted === null ? { deny: 'note_assumption needs an `assumption`: one plain sentence.' } : { result: noted }) as never
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const { notes } = whole(await read($, log))
    const newestFirst = [...notes].reverse()
    const shown = newestFirst.slice(0, SHOWN)
    const at = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    // Reject only drafts a correction in the prompt box; nothing is sent until you send it.
    const reject = async (note: Assumption): Promise<void> => {
      await $.prompt.fill({ text: `Assumption A${note.id} is wrong ("${note.text}"). Instead: `, mode: 'append' })
      await update($, log, raw => ({
        ...whole(raw),
        notes: whole(raw).notes.map(one => (one.id === note.id && one.status === 'open' ? { ...one, status: 'flagged' as const } : one)),
      }))
    }

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
          <Text bold>What Claude is assuming (newest first)</Text>
          <Button key="close" label="q Close" hotkey="q" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
        {notes.length === 0 && <Text dimColor>None yet. They appear here as Claude makes them.</Text>}
        {shown.map((note, i) => {
          const isOpen = note.status === 'open'
          const mark = note.status === 'replaced' ? `replaced by A${note.replacedBy ?? '?'}` : note.status === 'flagged' ? 'you rejected it' : ''

          return (
            <Box key={`note-${note.id}`} flexDirection="column" marginTop={i === 0 ? 0 : 1}>
              <Box flexDirection="row" justifyContent="space-between">
                <Text bold dimColor={!isOpen}>{`A${note.id} · ${at(note.at)}${note.isSubagent ? ' · subagent' : ''}`}</Text>
                {isOpen ? <Button key={`reject-${note.id}`} label={`${i + 1} Reject`} hotkey={`${i + 1}`} onPress={() => reject(note)} /> : <Text color={note.status === 'flagged' ? 'red' : 'gray'}>{mark}</Text>}
              </Box>
              <Text dimColor={!isOpen} strikethrough={note.status === 'replaced'} wrap="wrap">{note.text}</Text>
              {isOpen && note.basis !== '' && <Text dimColor wrap="wrap">{`because ${note.basis}`}</Text>}
              {isOpen && note.affects !== '' && <Text dimColor wrap="wrap">{`affects ${note.affects}`}</Text>}
            </Box>
          )
        })}
        {newestFirst.length > SHOWN && <Text dimColor>{`${newestFirst.length - SHOWN} older not shown`}</Text>}
      </Box>
    )
  })
}
