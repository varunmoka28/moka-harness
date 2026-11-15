import { atom, read } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

const unattended = atom({ plugin: 'unattended', key: 'on' } as const, false)

// A file changed within this long, by something other than this session, is "recently touched".
const WINDOW_MS = 30 * 60_000

// mtime of each file right after this session last wrote it. A later, different mtime means someone else wrote it.
const mine = new Map<string, number>()
let isInteractive = true

type Verdict = { deny?: string; note?: string }

// Decides whether this edit touches a file changed by something other than this session.
const inspect = async ($: EngineInterface, path: string): Promise<Verdict> => {
  const before = await $.fs.stat(path).catch(() => undefined)
  const known = mine.get(path)
  const isOther = before !== undefined && (known === undefined ? (await $.clock.now()) - before.mtimeMs < WINDOW_MS : before.mtimeMs !== known)
  if (!isOther || !isInteractive) return {}

  const ago = Math.max(1, Math.round(((await $.clock.now()) - before.mtimeMs) / 60_000))
  if (await read($, unattended)) {
    return { note: `collision-guard: ${path} changed ${ago} min ago outside this session's edits; unattended mode is on, so nobody was asked.` }
  }

  const answer = await $.ui
    .ask(`${path.split('/').pop()} changed ${ago} min ago, outside this session's edits. Edit it anyway?`, ['Proceed', 'Cancel'])
    .catch(() => 'Cancel')
  return answer === 'Proceed' ? {} : { deny: `collision-guard: ${path} changed ${ago} min ago outside this session's edits; the edit was cancelled.` }
}

export const register: Register = on => {
  on('session.start', ($, e, next) => {
    isInteractive = e.isInteractive

    return next(e)
  })

  // Edit and Write name file_path; NotebookEdit names notebook_path.
  for (const tool of ['Edit', 'Write', 'NotebookEdit'] as const) {
    on('tool.call', { tool }, ($, e, next) => {
      // If anything in the guard throws before the edit has run, fall back to a plain edit.
      let ran = false
      const guarded = async () => {
        const path = tool === 'NotebookEdit' ? (e as { notebook_path: string }).notebook_path : (e as { file_path: string }).file_path
        const verdict = await inspect($, path).catch((): Verdict => ({}))
        if (verdict.deny !== undefined) return { deny: verdict.deny }

        ran = true
        const result = await next(e)
        if (verdict.note !== undefined && typeof result.text === 'string') result.text += `\n${verdict.note}`
        if (result.deny === undefined && result.isError !== true) {
          const after = await $.fs.stat(path).catch(() => undefined)
          if (after !== undefined) mine.set(path, after.mtimeMs)
        }

        return result
      }

      return guarded().catch(err => (ran ? Promise.reject(err) : next(e)))
    })
  }
}
