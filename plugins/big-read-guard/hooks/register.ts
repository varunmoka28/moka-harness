import type { EngineInterface, Register } from 'claude-code'

// A text file over this many bytes on disk is blocked unless the Read names a range. 50 KB.
const MAX_BYTES = 51_200
// Size on disk says nothing about what these cost, and Read has its own limits for them.
const BUILT_IN_SKIP = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.ipynb']
const SETTINGS = '.claude/big-read-guard.json'

// One popup per session for each kind of failure; session.start resets both.
let warnedCheck = false
let warnedSettings = false

const ending = (path: string) => /\.[^./]+$/.exec(path)?.[0].toLowerCase() ?? ''
const isMissing = (err: unknown) => /ENOENT|no such file/i.test(String((err as Error)?.message ?? err))
const toast = ($: EngineInterface, text: string) => $.ui.toast(text, { timeoutMs: 15_000 })

// The user's extra file endings. No file means none; a broken one means none, with one popup.
async function userSkip($: EngineInterface): Promise<string[]> {
  let text: string
  try {
    text = await $.fs.read(`${await $.env.get('HOME')}/${SETTINGS}`)
  } catch (err) {
    if (isMissing(err)) return []
    throw err
  }
  try {
    const skip: unknown = JSON.parse(text).skip
    if (!Array.isArray(skip) || !skip.every(s => typeof s === 'string')) throw new Error('"skip" must be a list of file endings')

    return skip.map(s => (s.startsWith('.') ? s : `.${s}`).toLowerCase())
  } catch (err) {
    if (!warnedSettings) {
      warnedSettings = true
      toast($, `big-read-guard: ~/${SETTINGS} could not be read (${(err as Error).message}); using the built-in skip list.`)
    }

    return []
  }
}

// The block message, or undefined when the read may go ahead. Throws when the check itself fails.
async function check($: EngineInterface, path: string): Promise<string | undefined> {
  const end = ending(path)
  if (BUILT_IN_SKIP.includes(end) || (await userSkip($)).includes(end)) return undefined
  // Read expands ~ itself; stat and awk take the path literally, so a ~/ path would look missing and pass.
  const real = path === '~' || path.startsWith('~/') ? `${await $.env.get('HOME')}${path.slice(1)}` : path
  const st = await $.fs.stat(real)
  if (st.kind !== 'file' || st.size <= MAX_BYTES) return undefined
  // awk, not wc -l: it also counts a last line with no newline, so limit: <lines> really covers the file.
  // ponytail: one full pass over the file per block; fine at the 3-a-day rate measured, revisit if it shows as lag.
  const ran = await $.process.run(['awk', 'END { print NR }', real])
  const count = ran.stdout.trim()
  const lines = Number(count)
  if (ran.exitCode !== 0 || !/^\d+$/.test(count) || !Number.isSafeInteger(lines) || lines < 1) throw new Error(`line count failed: ${ran.stderr.trim() || `exit ${ran.exitCode}`}`)

  return `big-read-guard: ${path} is ${Math.round(st.size / 1024)} KB, ${lines} lines. Grep for what you need, or Read with offset and limit. To read all of it on purpose: offset: 1, limit: ${lines}.`
}

export const register: Register = on => {
  on('session.start', (_, e, next) => {
    warnedCheck = false
    warnedSettings = false

    return next(e)
  })

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    if (e.offset !== undefined && e.limit !== undefined) return next(e)
    let message: string | undefined
    try {
      message = await check($, e.file_path)
    } catch (err) {
      // A missing file is Read's to report. Anything else means the guard is not working: say so once.
      if (!isMissing(err) && !warnedCheck) {
        warnedCheck = true
        toast($, `big-read-guard: check failed on ${e.file_path}, reads are not guarded: ${(err as Error)?.message ?? err}`)
      }
    }

    return message === undefined ? next(e) : { deny: message }
  })
}
