import type { Candidate, Io, Run } from '../types'
import { TARGETS, isShellError } from './targets'

export const GB = 1024 ** 3
export const THRESHOLD = 30 * GB

// `df -k <path>`: second line, fourth column is available 1K blocks.
export function parseDf(stdout: string): number | null {
  const line = stdout.trim().split('\n')[1]
  if (!line) return null
  const avail = Number(line.trim().split(/\s+/)[3])
  return Number.isFinite(avail) ? avail * 1024 : null
}

export async function freeBytes(run: Run, home: string): Promise<number | null> {
  const r = await run(['df', '-k', home])
  return r && r.exitCode === 0 ? parseDf(r.stdout) : null
}

export function fmt(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)}G`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)}M`
  return `${Math.round(bytes / 1024)}K`
}

// The session's config dir: CLAUDE_CONFIG_DIR when it is an absolute folder under home, else ~/.claude.
// Then the `alsoSweep` folders (comma-separated, ~ allowed) that pass the same check.
// rm runs inside them, so home itself and anything with ".." are never trusted.
export function configDirs(home: string, configDir?: string, also = ''): string[] {
  const trusted = (d: string) => home !== '' && d.startsWith(`${home}/`) && !d.split('/').includes('..')
  const given = (configDir ?? '').replace(/\/$/, '')
  const out = [trusted(given) ? given : `${home}/.claude`]
  for (const p of also.split(',')) {
    const d = p.trim().replace(/^~(?=\/)/, home).replace(/\/$/, '')
    if (trusted(d) && !out.includes(d)) out.push(d)
  }
  return out
}

// The folders the user listed in `deleteRoots` (comma-separated, ~ allowed). Same trust check as configDirs.
// Nothing outside them is ever removed, and an empty list removes nothing.
export function parseRoots(home: string, list = ''): string[] {
  const out: string[] = []
  for (const p of list.split(',')) {
    const d = p.trim().replace(/^~(?=\/)/, home).replace(/\/$/, '')
    if (home !== '' && d.startsWith(`${home}/`) && !d.split('/').includes('..') && !out.includes(d)) out.push(d)
  }
  return out
}

export const underRoots = (path: string, roots: string[]) => roots.some(r => path.startsWith(`${r}/`))

// The find, stat and df flags this mod uses are the macOS ones.
export async function isMac(run: Run): Promise<boolean> {
  const r = await run(['uname', '-s'])
  return r?.exitCode === 0 && r.stdout.trim() === 'Darwin'
}

export function parseDays(args: string): number {
  const m = args.match(/--days\s+(\d+)(?=\s|$)/)
  const n = m ? Number(m[1]) : 0
  return n >= 1 ? n : 14
}

export async function scan(io: Io, dirs: string[], days: number): Promise<{ candidates: Candidate[]; notes: string[]; error?: string }> {
  const candidates: Candidate[] = []
  const notes: string[] = []
  try {
    for (const dir of dirs) {
      const r = await io.run(['test', '-d', dir])
      if (!r || r.exitCode !== 0) continue
      for (const t of TARGETS) {
        const found = await t.find(io, dir, days)
        candidates.push(...found.candidates)
        if (found.note) notes.push(found.note)
      }
    }
  } catch (e) {
    if (isShellError(e)) return { candidates: [], notes, error: e.message }
    throw e
  }
  return { candidates, notes }
}

// Safe first, then larger first.
export const order = (list: Candidate[]) => [...list].sort((a, b) => (a.tier === b.tier ? b.bytes - a.bytes : a.tier === 'safe' ? -1 : 1))

// One row per group; a size column per config dir, shown by its basename.
export function table(candidates: Candidate[], dirs: string[]): string {
  const groups = [...new Set(candidates.map(c => c.group))]
  const names = dirs.map(d => d.split('/').pop()!)
  const sum = (group: string, dir: string) => candidates.filter(c => c.group === group && c.dir === dir).reduce((n, c) => n + c.bytes, 0)
  const w0 = Math.max('group'.length, ...groups.map(g => g.length)) + 2
  const cols = (cells: string[], first: string) => first.padEnd(w0) + cells.map((c, i) => c.padStart(names[i]!.length + 2)).join('') + '  '
  const head = cols(names, 'group') + 'tier'
  const rows = groups.map(g => {
    const tier = candidates.find(c => c.group === g)!.tier
    return cols(dirs.map(d => (sum(g, d) ? fmt(sum(g, d)) : '0')), g) + tier
  })
  return [head, ...rows].join('\n')
}

// rm -rf in chunks of 200 so a long file list stays under the argv limit. Null on success.
export async function rm(run: Run, paths: string[]): Promise<string | null> {
  for (let i = 0; i < paths.length; i += 200) {
    const r = await run(['rm', '-rf', '--', ...paths.slice(i, i + 200)], 300_000)
    if (!r) return 'rm did not run'
    if (r.exitCode !== 0) return (r.stderr ?? '').trim() || `rm exit ${r.exitCode}`
  }
  return null
}
