import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Last } from '../types'

// How long the prompt cache stays warm after the last request: an hour on a
// subscription, five minutes on API billing or in usage overage. Set CACHE_CLOCK_TTL_MINUTES to change it.
const DEFAULT_TTL_MINUTES = 60
const ttlMinutes = async ($: EngineInterface) => {
  const minutes = Number(await $.env.get('CACHE_CLOCK_TTL_MINUTES'))

  return Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_TTL_MINUTES
}
// From this many minutes left, the band turns yellow
const WARN_MINUTES = 10
// From this many minutes left, a toast says the cache is about to go cold
const NOTIFY_MINUTES = 5
// The `at` of the window already warned about, so each window warns once
let warned = 0
// A running turn refreshes the cache with every request, so the countdown is not real until it ends
let isRunning = false
// Squares in the bar; a full bar is a full TTL
const CELLS = 20

const last = atom({ plugin: 'cache-clock', key: 'last' } as const, null)

// What the other mods have to say, drawn as one green line under the clock
const unattended = atom({ plugin: 'unattended', key: 'on' } as const, false)
const asks = atom({ plugin: 'layman', key: 'asks' } as const, 0)
// layman's own threshold: plain mode is on from the second ask
const PLAIN_FROM = 2
const NOTES_COLOR = '#4ade80'

export const register: Register = on => {
  on('session.start', ($, e, next) => {
    // The band changes as time passes, so draw it again twice a minute
    $.clock.every(30_000, async () => {
      $.ui.invalidate('ui.render')

      // One toast per cache window, when it is about to go cold
      const seen = await read($, last)
      if (seen === null || seen.at === warned || isRunning) return
      const left = (await ttlMinutes($)) - Math.floor(((await $.clock.now()) - seen.at) / 60_000)
      if (left > 0 && left <= NOTIFY_MINUTES) {
        warned = seen.at
        $.ui.toast(`cache goes cold in ${left} min: send a message to keep it warm`, { timeoutMs: 15_000 })
      }
    })

    return next(e)
  })

  on('turn.start', (_, e, next) => {
    isRunning = true

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // A subagent can finish while the main turn is still running
    if (e.agentId === undefined) isRunning = false
    // Only the main conversation's own requests keep its cache warm
    if (e.agentId === undefined && e.usage !== undefined) {
      const at = await $.clock.now()
      const { context } = await $.session.usage()
      const { input_tokens, cache_read_input_tokens, cache_creation_input_tokens } = e.usage
      const sent = input_tokens + cache_read_input_tokens + cache_creation_input_tokens
      const hit = sent === 0 ? null : Math.round((100 * cache_read_input_tokens) / sent)
      const seen: Last = { at, tokens: context.tokens ?? null, hit }
      await update($, last, () => seen)
    }

    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)

    // A compacted conversation is a new, short prefix: the old cache no longer matters
    if (e.agentId === undefined && e.trigger !== 'precompute' && result.skip === undefined) {
      await update($, last, () => null)
    }

    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const seen = await read($, last)
    const notes = [
      (await read($, unattended)) ? 'unattended on' : null,
      (await read($, asks)) >= PLAIN_FROM ? 'plain mode' : null,
    ].filter((n): n is string => n !== null)
    const { Box, Button, Text } = $.ui.resolve(e)
    const notesRow = notes.length === 0 ? null : <Text color={NOTES_COLOR}>{notes.join(' · ')}</Text>

    // A running turn refreshes the cache with every request, so there is nothing to count down
    if (e.props.hasSurvey || e.props.isWorking || seen === null) {
      if (notesRow === null || e.props.hasSurvey) return next(e)
      return (
        <Box flexDirection="column">
          {await next(e)}
          {notesRow}
        </Box>
      )
    }

    // Mods beneath this one (next-steps) draw here too, so pass the band on
    const below = await next(e)
    const ttl = await ttlMinutes($)
    const left = Math.max(0, ttl - Math.floor(((await $.clock.now()) - seen.at) / 60_000))
    const color = left === 0 ? 'red' : left <= WARN_MINUTES ? 'yellow' : '#4ade80'
    const filled = Math.round((left / ttl) * CELLS)
    // Warm: how much of the last turn the cache served. Cold: what the next message re-sends in full.
    const note =
      left > 0
        ? seen.hit == null ? '' : `last reply ${seen.hit}% cheap`
        : seen.tokens === null ? '' : `next message re-sends ${Math.round(seen.tokens / 1000)}k`

    return (
      <Box flexDirection="column" flexGrow={1}>
        {below}
        {/* The engine draws its own [-] over the row's last three columns */}
        <Box justifyContent="space-between" paddingRight={4}>
          <Box gap={1}>
            <Text color={color}>●</Text>
            <Text color={color} bold>
              {left === 0 ? 'full price' : `cheap for ${left} min`}
            </Text>
            <Box>
              <Text color={color}>{'■'.repeat(filled)}</Text>
              <Text dimColor>{'■'.repeat(CELLS - filled)}</Text>
            </Box>
            <Text color={color}>{note}</Text>
          </Box>
          <Button
            key="compact"
            label="Compact"
            hotkey="c"
            onPress={async () => {
              // $.session.compact skips this mod's own session.compact hook, so clear the clock here
              const { skip } = await $.session.compact()
              if (skip === undefined) {
                await update($, last, () => null)
              }
            }}
          />
        </Box>
        {notesRow}
      </Box>
    )
  })
}
