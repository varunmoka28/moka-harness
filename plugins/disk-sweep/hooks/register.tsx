import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Candidate, Io, Scan } from '../types'
import { THRESHOLD, configDirs, fmt, freeBytes, isMac, order, parseDays, parseRoots, rm, scan, table, underRoots } from './scan'

export const state = atom({ plugin: 'disk-sweep', key: 'scan' } as const, null as Scan | null)
export const confirm = atom({ plugin: 'disk-sweep', key: 'confirm' } as const, false)

let dirs: string[] = []
// Set from the plugin's options at session start. Deleting needs dryRun off AND a folder listed in deleteRoots.
let dryRun = true
let roots: string[] = []
// True while a removal runs; every band button is ignored until it ends.
let busy = false

// $ never crosses a file boundary in a mod, so the scanner gets this closure instead.
export const io = async ($: EngineInterface): Promise<Io> => ({
  // Cut-off output can hold a half-written path, so it counts as a failed command.
  run: (argv, timeoutMs = 120_000) =>
    $.process.run(argv, { timeoutMs }).then(r => (r.isStdoutTruncated ? { exitCode: 1, stdout: '', stderr: 'output too large' } : r)).catch(() => null),
  read: path => $.fs.read(path).then(t => t as string).catch(() => null),
  now: await $.clock.now(),
})

export async function setScan($: EngineInterface, s: Scan | null) {
  await update($, state, () => s)
  await $.store.set('scan', s)
}

async function patch($: EngineInterface, fn: (c: Candidate) => Candidate) {
  const s = await read($, state)
  if (s) await setScan($, { ...s, candidates: s.candidates.map(fn) })
}

// Any press other than Confirm drops a pending confirmation.
export async function toggle($: EngineInterface, id: string) {
  if (busy) return
  await update($, confirm, () => false)
  await patch($, c => (c.id === id ? { ...c, ticked: !c.ticked } : c))
}

export async function tickSafe($: EngineInterface) {
  if (busy) return
  await update($, confirm, () => false)
  await patch($, c => (c.tier === 'safe' ? { ...c, ticked: true } : c))
}

export async function dismiss($: EngineInterface) {
  if (busy) return
  await update($, confirm, () => false)
  await setScan($, null)
}

// Every action goes to ${CLAUDE_PLUGIN_DATA}/disk-sweep.log. A false return means the log is unwritable.
async function log($: EngineInterface, lines: string[]): Promise<boolean> {
  const dir = await $.env.get('CLAUDE_PLUGIN_DATA')
  if (!dir || !lines.length) return !!dir
  const file = `${dir}/disk-sweep.log`
  const stamp = new Date(await $.clock.now()).toISOString()
  try {
    const before = await $.fs.read(file).then(t => t as string).catch(() => '')
    await $.fs.write(file, before + lines.map(l => `${stamp} ${l}\n`).join(''))
    return true
  } catch {
    return false
  }
}

// First press arms Confirm; second press rescans, then deletes the ticked rows one by one.
// Only paths the fresh scan still finds are removed, so a stored scan never deletes against an old measurement.
export async function remove($: EngineInterface) {
  if (busy) return
  busy = true // set before the first await, so two presses in the same tick cannot both proceed
  try {
    const s = await read($, state)
    if (!s || !s.candidates.some(c => c.ticked)) return
    if (!(await read($, confirm))) {
      await update($, confirm, () => true)
      return
    }
    await update($, confirm, () => false)
    const x = await io($)
    const fresh = await scan(x, dirs, s.days)
    if (fresh.error) {
      $.ui.toast(fresh.error)
      return
    }
    // ponytail: a fresh candidate's bytes are split evenly over its paths; keep per-file sizes if partial matches need exact totals.
    const share = new Map<string, number>()
    for (const f of fresh.candidates) for (const p of f.paths) share.set(p, f.bytes / f.paths.length)
    let freed = 0
    let held = 0 // items a dry run would have removed
    let heldBytes = 0
    let blocked = 0 // items outside deleteRoots, left alone
    let left: Candidate[] = s.candidates
    for (const c of s.candidates) {
      if (!c.ticked) continue
      const found = c.paths.filter(p => share.has(p))
      const paths = found.filter(p => underRoots(p, roots))
      const outside = found.filter(p => !underRoots(p, roots))
      if (found.length && (dryRun || !paths.length)) {
        const lines = [...paths.map(p => `would remove ${p}`), ...outside.map(p => `skipped (not under deleteRoots) ${p}`)]
        if (!(await log($, lines))) return $.ui.toast('disk-sweep: cannot write the log under CLAUDE_PLUGIN_DATA; nothing was removed.')
        held += paths.length
        heldBytes += paths.reduce((n, p) => n + share.get(p)!, 0)
        blocked += outside.length
        continue
      }
      // Log the intent first: if the log cannot be written, nothing is deleted.
      const intent = [...paths.map(p => `removing ${p}`), ...outside.map(p => `skipped (not under deleteRoots) ${p}`)]
      if (!(await log($, intent))) return $.ui.toast('disk-sweep: cannot write the log under CLAUDE_PLUGIN_DATA; nothing was removed.')
      blocked += outside.length
      const err = paths.length ? await rm(x.run, paths) : null
      if (paths.length) await log($, [err ? `failed ${paths.length} item(s): ${err}` : `removed ${paths.length} item(s)`])
      if (err) left = left.map(k => (k.id === c.id ? { ...c, ticked: false, reason: `rm failed: ${err}` } : k))
      else {
        left = left.filter(k => k.id !== c.id)
        freed += paths.reduce((n, p) => n + share.get(p)!, 0)
      }
      await setScan($, left.length ? { ...s, candidates: left } : null)
    }
    if (freed) $.ui.status(`💽 freed ${fmt(freed)}`)
    if (dryRun && held) $.ui.toast(`disk-sweep dry run: would remove ${held} item${held === 1 ? '' : 's'} (${fmt(heldBytes)}); nothing was deleted. Turn off "dryRun" in the plugin options to delete.`)
    else if (blocked) $.ui.toast(roots.length ? `disk-sweep: ${blocked} item${blocked === 1 ? ' is' : 's are'} not under your deleteRoots and was left alone.` : 'disk-sweep: set "deleteRoots" in the plugin options first; nothing was removed.')
  } finally {
    busy = false
  }
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    try {
      const x = await io($)
      if (!(await isMac(x.run))) return next(e)
      const home = (await $.env.get('HOME')) ?? ''
      dirs = configDirs(home, await $.env.get('CLAUDE_CONFIG_DIR'), String(options.alsoSweep ?? ''))
      dryRun = options.dryRun !== false && options.dryRun !== 'false'
      roots = parseRoots(home, String(options.deleteRoots ?? ''))
      const stored = ((await $.store.get('scan')) ?? null) as Scan | null
      await update($, state, () => stored)
      await $.command.register({ name: 'disk', description: 'Find and remove stale Claude Code data', argumentHint: '[--days N]' })
      const free = await freeBytes(x.run, home)
      if (free !== null && free < THRESHOLD) {
        $.ui.status(`💽 ${fmt(free)} free · /disk`)
        const today = new Date(await $.clock.now()).toISOString().slice(0, 10)
        if ((await $.store.get('warnedOn')) !== today) {
          $.ui.toast(`Disk low: ${fmt(free)} free. Run /disk to sweep Claude data.`)
          await $.store.set('warnedOn', today)
        }
      }
    } catch {
      // A failed disk check must never stop the session from starting.
    }
    return next(e)
  })

  on('command.run', { command: 'disk' }, async ($, e) => {
    const days = parseDays(e.args)
    const r = await scan(await io($), dirs, days)
    if (r.error) return { text: r.error }
    await update($, confirm, () => false)
    await setScan($, r.candidates.length ? { at: new Date(await $.clock.now()).toISOString(), days, candidates: r.candidates } : null)
    if (!r.candidates.length) return { text: [...r.notes, 'Nothing to sweep.'].join('\n') }
    return { text: [...r.notes, table(r.candidates, dirs)].join('\n') }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below
    const s = await read($, state)
    if (!s) return below
    const { Box, Button, Text } = $.ui.resolve(e)
    const ticked = s.candidates.filter(c => c.ticked)
    const sum = ticked.reduce((n, c) => n + c.bytes, 0)
    const pending = await read($, confirm)
    const band = (
      <Box flexDirection="column">
        <Text dimColor>disk-sweep · scanned {s.at.slice(0, 16).replace('T', ' ')} · transcripts older than {s.days}d</Text>
        {order(s.candidates).map(c => (
          <Box key={c.id}>
            <Text>{c.ticked ? '☑' : '☐'} {fmt(c.bytes).padStart(7)} {c.tier.padEnd(4)} {c.dir.split('/').pop()} {c.label} </Text>
            <Text dimColor>{c.reason} </Text>
            <Button key={`t-${c.id}`} label={c.ticked ? 'Untick' : 'Tick'} onPress={() => toggle($, c.id)} />
          </Box>
        ))}
        <Box>
          <Button key="all-safe" label="Tick all safe" onPress={() => tickSafe($)} />
          <Button key="remove" label={pending ? `Confirm ${fmt(sum)}?` : `Remove ticked (${ticked.length}, ${fmt(sum)})`} onPress={() => remove($)} />
          <Button key="dismiss" label="Dismiss" onPress={() => dismiss($)} />
        </Box>
      </Box>
    )
    return below ? <Box flexDirection="column">{below}{band}</Box> : band
  })
}
