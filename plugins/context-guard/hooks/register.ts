import type { EngineInterface, Register, Timer } from 'claude-code'

// Every request re-sends the whole context, so past this size each further turn is expensive.
const FIRST = 150_000
const STEP = 100_000
// With CONTEXT_GUARD_AUTO_COMPACT=1, a tab idle this long with a big context compacts itself, well
// inside the cache's ~1 hour life: compacting after the cache has gone cold would rewrite the whole
// context at the write rate.
const IDLE_MS = 10 * 60_000

// The last band warned about: 0 below FIRST, then one per STEP above it.
let warned = 0
let timer: Timer | undefined
// A headless run (claude -p, a hook's helper session) must neither warn nor arm.
let isInteractive = false

const band = (tokens: number) => (tokens < FIRST ? 0 : 1 + Math.floor((tokens - FIRST) / STEP))
const k = (n: number) => `${Math.round(n / 1000)}K`

const stop = () => {
  timer?.cancel()
  timer = undefined
}

// Compacting spends model tokens on its own, so it is opt-in.
async function arm($: EngineInterface, tokens: number) {
  stop()
  if (tokens < FIRST || (await $.env.get('CONTEXT_GUARD_AUTO_COMPACT')) !== '1') return

  timer = $.clock.after(IDLE_MS, () => {
    timer = undefined
    void (async () => {
      const done = await $.session.compact()
      warned = 0
      $.ui.toast(done.skip === undefined ? `Compacted from ${k(tokens)} after ${IDLE_MS / 60_000} idle minutes.` : `Compact skipped: ${done.skip}`, {
        timeoutMs: 15_000,
      })
    })().catch(() => {})
  })
}

export const register: Register = on => {
  // Also runs again on every plugin reload, which cancels the timer: so a tab already over the line re-arms here.
  on('session.start', async ($, e, next) => {
    stop()
    warned = 0
    isInteractive = e.isInteractive
    try {
      if (isInteractive) {
        const { tokens } = (await $.session.usage()).context
        if (tokens !== undefined) {
          warned = band(tokens)
          await arm($, tokens)
        }
      }
    } catch {}

    return next(e)
  })

  on('session.end', (_, e, next) => {
    stop()

    return next(e)
  })

  // Any new work means the tab is not idle.
  on('prompt.submit', (_, e, next) => {
    stop()

    return next(e).catch(() => e)
  })
  on('turn.start', (_, e, next) => {
    stop()

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // The main loop only: a subagent's window is not the session's.
    try {
      if (isInteractive && e.agentId === undefined && !e.isAborted) {
        const { tokens } = (await $.session.usage()).context
        if (tokens !== undefined) {
          const now = band(tokens)
          if (now > warned) {
            $.ui.toast(`Context is ${k(tokens)} tokens. Every turn re-sends it: /park, then /clear, or /compact, before the next task.`, {
              timeoutMs: 15_000,
            })
          }
          // A compaction or /clear that shrank the context re-arms the warning.
          warned = now
          await arm($, tokens)
        }
      }
    } catch {}

    return next(e)
  })
}
