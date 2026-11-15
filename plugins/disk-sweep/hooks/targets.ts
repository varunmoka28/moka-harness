import type { Candidate, Io, Tier } from '../types'

export type Found = { candidates: Candidate[]; note?: string }
export type Target = { group: string; tier: Tier; find: (io: Io, dir: string, days: number) => Promise<Found> }

// `find ... -exec stat -f '%z %m %N' {} +` lines: bytes, mtime epoch, path (may contain spaces).
export function parseStat(stdout: string): { bytes: number; mtime: number; path: string }[] {
  return stdout
    .split('\n')
    .filter(Boolean)
    .map(l => {
      const [bytes, mtime, ...rest] = l.split(' ')
      return { bytes: Number(bytes), mtime: Number(mtime), path: rest.join(' ') }
    })
    .filter(f => Number.isFinite(f.bytes) && Number.isFinite(f.mtime))
}

// `stat -f '%m %N'` lines: mtime epoch, path.
export function parseMtime(stdout: string): { mtime: number; path: string }[] {
  return stdout
    .split('\n')
    .filter(Boolean)
    .map(l => {
      const [mtime, ...rest] = l.split(' ')
      return { mtime: Number(mtime), path: rest.join(' ') }
    })
    .filter(d => Number.isFinite(d.mtime))
}

// `du -sk a b` lines: kilobytes, tab, path.
export function parseDu(stdout: string): Map<string, number> {
  const m = new Map<string, number>()
  for (const l of stdout.split('\n')) {
    const i = l.indexOf('\t')
    const k = l.slice(0, i)
    const p = l.slice(i + 1)
    if (i > 0 && p && Number.isFinite(Number(k))) m.set(p, Number(k) * 1024)
  }
  return m
}

// installed_plugins.json: { plugins: { "<name>@<mp>": [{ installPath }] } }
export function installPaths(json: unknown): Set<string> {
  const plugins = (json as { plugins?: Record<string, { installPath?: string }[]> } | null)?.plugins ?? {}
  return new Set(
    Object.values(plugins)
      .flat()
      .map(e => e?.installPath?.replace(/\/$/, ''))
      .filter((p): p is string => !!p),
  )
}

// A version dir is stale when it is not installed but a sibling of the same plugin is.
// Age is checked separately in staleVersions, since an old session may still run it.
export function staleDirs(dirs: string[], installed: Set<string>): string[] {
  const parent = (p: string) => p.slice(0, p.lastIndexOf('/'))
  const livePlugins = new Set([...installed].map(parent))
  return dirs.filter(d => !installed.has(d) && livePlugins.has(parent(d)))
}

// projects/<folder> is the cwd with slashes turned to dashes; drop the home part.
export const projectLabel = (folder: string) => folder.replace(/^-Users-[^-]+-?/, '') || '~'

class ShellError extends Error {}

// A non-zero exit is a scan failure the command reports verbatim.
async function sh(io: Io, argv: string[]): Promise<string> {
  const r = await io.run(argv)
  if (!r) throw new ShellError(`${argv[0]} did not run`)
  if (r.exitCode !== 0) throw new ShellError(`${argv.join(' ')}: ${(r.stderr ?? '').trim() || `exit ${r.exitCode}`}`)
  return r.stdout
}

export const isShellError = (e: unknown): e is ShellError => e instanceof ShellError

const exists = async (io: Io, path: string) => ((await io.run(['test', '-d', path]))?.exitCode ?? 1) === 0

const lines = (s: string) => s.split('\n').filter(Boolean)

// Names with a newline would split into forged lines in find's output, so never list them.
const NO_NL = ['-not', '-path', '*\n*']

const STAT = [...NO_NL, '-exec', 'stat', '-f', '%z %m %N', '{}', '+']

const DAY = 86_400

// The only places a candidate path may live, relative to its config dir.
const SCOPE = ['plugins/cache/', 'file-history/', 'debug/', 'projects/']

const date = (epoch: number) => new Date(epoch * 1000).toISOString().slice(0, 10)

// Every target goes through here: a path outside SCOPE fails the whole scan, so nothing is listed.
function candidate(dir: string, group: string, tier: Tier, label: string, reason: string, paths: string[], bytes: number): Candidate {
  if (!paths.length) throw new ShellError(`${group}: candidate with no paths`)
  for (const p of paths) {
    const rel = p.startsWith(`${dir}/`) ? p.slice(dir.length + 1) : ''
    const inScope = p.startsWith('/') && SCOPE.some(s => rel.startsWith(s) && rel.length > s.length)
    if (!inScope || p.split('/').includes('..') || p.includes('\n')) throw new ShellError(`refusing path outside the sweep scope: ${p}`)
  }
  if (!Number.isFinite(bytes) || bytes < 0) throw new ShellError(`${paths[0]}: bad size ${bytes}`)
  return { id: `${dir}:${group}:${paths[0]}`, dir, group, tier, label, reason, paths, bytes, ticked: false }
}

type Stat = ReturnType<typeof parseStat>[number]

function fileGroup(dir: string, group: string, tier: Tier, label: string, days: number, files: Stat[]): Candidate {
  let min = Infinity
  for (const f of files) if (f.mtime < min) min = f.mtime
  const oldest = date(min)
  return candidate(dir, group, tier, label, `${files.length} ${files.length === 1 ? 'file' : 'files'} older than ${days}d, oldest ${oldest}`, files.map(f => f.path), files.reduce((n, f) => n + f.bytes, 0))
}

// Files under <dir>/<sub> older than `days`, as one candidate.
function agedFiles(sub: string, days: number, tier: Tier): Target {
  return {
    group: sub,
    tier,
    async find(io, dir) {
      const root = `${dir}/${sub}`
      if (!(await exists(io, root))) return { candidates: [] }
      const files = parseStat(await sh(io, ['find', root, '-type', 'f', '-mtime', `+${days}`, ...STAT]))
      return { candidates: files.length ? [fileGroup(dir, sub, tier, sub, days, files)] : [] }
    },
  }
}

const staleVersions: Target = {
  group: 'stale plugin versions',
  tier: 'safe',
  async find(io, dir) {
    const cache = `${dir}/plugins/cache`
    if (!(await exists(io, cache))) return { candidates: [] }
    let installed: Set<string>
    try {
      installed = installPaths(JSON.parse((await io.read(`${dir}/plugins/installed_plugins.json`)) ?? ''))
    } catch {
      return { candidates: [], note: `${dir}: installed_plugins.json unreadable, stale versions skipped` }
    }
    const listed = parseMtime(await sh(io, ['find', cache, '-mindepth', '3', '-maxdepth', '3', '-type', 'd', '-not', '-path', '*/temp_*', ...NO_NL, '-exec', 'stat', '-f', '%m %N', '{}', '+']))
    const marked = new Set(lines(await sh(io, ['find', cache, '-mindepth', '4', '-maxdepth', '4', '-name', '.orphaned_at', ...NO_NL])).map(p => p.slice(0, p.lastIndexOf('/'))))
    const secs = new Map(listed.map(d => [d.path, io.now / 1000 - d.mtime]))
    // A session started before an update may still run the old version: wait 1d after Claude orphans it, 7d otherwise.
    const stale = staleDirs([...secs.keys()], installed).filter(d => secs.get(d)! > (marked.has(d) ? 1 : 7) * DAY)
    if (!stale.length) return { candidates: [] }
    const sizes = parseDu(await sh(io, ['du', '-sk', ...stale]))
    const current = (plugin: string) => [...installed].find(i => i.startsWith(`${plugin}/`))?.split('/').pop()
    return {
      candidates: stale.map(p => {
        const plugin = p.slice(0, p.lastIndexOf('/'))
        const [name, ver] = p.split('/').slice(-2)
        return candidate(dir, 'stale plugin versions', 'safe', `${name} ${ver}`, `not installed, ${current(plugin)} is; ${marked.has(p) ? 'orphaned' : 'untouched'} ${Math.floor(secs.get(p)! / DAY)}d${marked.has(p) ? ' ago' : ''}`, [p], sizes.get(p) ?? 0)
      }),
    }
  },
}

const tempClones: Target = {
  group: 'plugin cache temp clones',
  tier: 'safe',
  async find(io, dir) {
    const cache = `${dir}/plugins/cache`
    if (!(await exists(io, cache))) return { candidates: [] }
    const dirs = lines(await sh(io, ['find', cache, '-mindepth', '1', '-maxdepth', '1', '(', '-name', 'temp_git_*', '-o', '-name', 'temp_subdir_*', ')', '-mtime', '+0', ...NO_NL]))
    if (!dirs.length) return { candidates: [] }
    const sizes = parseDu(await sh(io, ['du', '-sk', ...dirs]))
    const bytes = dirs.reduce((n, d) => n + (sizes.get(d) ?? 0), 0)
    return { candidates: [candidate(dir, 'plugin cache temp clones', 'safe', `${dirs.length} temp clones`, 'temp_git_* / temp_subdir_* older than 1d', dirs, bytes)] }
  },
}

const transcripts: Target = {
  group: 'old transcripts',
  tier: 'look',
  async find(io, dir, days) {
    const root = `${dir}/projects`
    if (!(await exists(io, root))) return { candidates: [] }
    const files = parseStat(await sh(io, ['find', root, '-name', '*.jsonl', '-type', 'f', '-mtime', `+${days}`, ...STAT]))
    const byProject = new Map<string, Stat[]>()
    for (const f of files) {
      const p = f.path.slice(root.length + 1).split('/')[0]!
      byProject.set(p, [...(byProject.get(p) ?? []), f])
    }
    return { candidates: [...byProject].map(([p, fs]) => fileGroup(dir, 'old transcripts', 'look', projectLabel(p), days, fs)) }
  },
}

export const TARGETS: Target[] = [staleVersions, tempClones, agedFiles('file-history', 30, 'safe'), agedFiles('debug', 7, 'safe'), transcripts]
