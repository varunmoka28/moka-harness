import { expect, mock, test } from 'claude-code/testing'

import type { Io, Reply, Run, Tier } from '../types'
import { GB, THRESHOLD, configDirs, fmt, freeBytes, isMac, order, parseDays, parseDf, rm, scan, table } from './scan'

const ok = (stdout = ''): Reply => ({ exitCode: 0, stdout })

// Table-driven shell: the last key that is a prefix of the joined argv wins.
export function fake(t: Record<string, Reply | (() => Reply)>) {
  const calls: string[] = []
  const run: Run = async argv => {
    const cmd = argv.join(' ')
    calls.push(cmd)
    const key = Object.keys(t).reverse().find(k => cmd.startsWith(k))
    const hit = key ? t[key]! : { exitCode: 127, stdout: '' }
    return typeof hit === 'function' ? hit() : hit
  }
  return { run, calls }
}

const DF = 'Filesystem   1024-blocks      Used Available Capacity iused ifree %iused  Mounted on\n/dev/disk3s5   239362496 156237824  26214400    86% 2300000 261000000    1%   /System/Volumes/Data\n'

test('parseDf reads the available column in bytes', () => {
  expect(parseDf(DF)).toBe(26214400 * 1024)
  expect(parseDf('')).toBeNull()
  expect(parseDf('Filesystem only\n')).toBeNull()
})

test('freeBytes runs df -k on home and compares against 30 GB', async () => {
  const { run, calls } = fake({ 'df -k /opt/hm': ok(DF) })
  const free = await freeBytes(run, '/opt/hm')
  expect(calls).toEqual(['df -k /opt/hm'])
  expect(free).toBe(25 * GB)
  expect(free! < THRESHOLD).toBe(true)
  expect(await freeBytes(fake({}).run, '/opt/hm')).toBeNull()
})

test('fmt picks G, M or K', () => {
  expect(fmt(25 * GB)).toBe('25.0G')
  expect(fmt(9.7 * GB)).toBe('9.7G')
  expect(fmt(250 * 1024 * 1024)).toBe('250M')
  expect(fmt(40 * 1024)).toBe('40K')
})

test('configDirs returns the session config dir, or ~/.claude when none is given', () => {
  expect(configDirs('/opt/hm')).toEqual(['/opt/hm/.claude'])
  expect(configDirs('/opt/hm', '/opt/hm/.claude/')).toEqual(['/opt/hm/.claude'])
  expect(configDirs('/opt/hm', '/opt/hm/work/claude-config')).toEqual(['/opt/hm/work/claude-config'])
})

test('configDirs ignores a CLAUDE_CONFIG_DIR that is not a folder under home', () => {
  for (const bad of ['/', '/opt/hm', '/opt/hm/', 'relative', '-x', '/opt/hm/../.claude', '/tmp/.claude', '/opt/hmx/.claude']) {
    expect(configDirs('/opt/hm', bad)).toEqual(['/opt/hm/.claude'])
  }
})

test('configDirs adds the alsoSweep folders after the session one, skipping repeats and untrusted ones', () => {
  expect(configDirs('/opt/hm', '/opt/hm/.claude-work', '~/.claude, ~/.claude-work')).toEqual(['/opt/hm/.claude-work', '/opt/hm/.claude'])
  expect(configDirs('/opt/hm', undefined, '~/.claude-work/, /tmp/x, ~/../y, ~, ')).toEqual(['/opt/hm/.claude', '/opt/hm/.claude-work'])
})

test('isMac is true only when uname says Darwin', async () => {
  expect(await isMac(fake({ uname: ok('Darwin\n') }).run)).toBe(true)
  expect(await isMac(fake({ uname: ok('Linux\n') }).run)).toBe(false)
  expect(await isMac(fake({}).run)).toBe(false)
})

test('parseDays reads --days N and falls back to 14', () => {
  expect(parseDays('')).toBe(14)
  expect(parseDays('--days 30')).toBe(30)
  expect(parseDays('--days 0')).toBe(14)
  expect(parseDays('--days x')).toBe(14)
  expect(parseDays('--days')).toBe(14)
  expect(parseDays('--days 1e3')).toBe(14)
  expect(parseDays('--days 30.5')).toBe(14)
  expect(parseDays('--days 30 ')).toBe(30)
})

import { installPaths, parseDu, parseStat, projectLabel, staleDirs } from './targets'

test('parseStat reads "bytes mtime path" lines, paths may contain spaces', () => {
  expect(parseStat('1024 1700000000 /a/b.jsonl\n2048 1700000001 /a/c d.jsonl\n')).toEqual([
    { bytes: 1024, mtime: 1700000000, path: '/a/b.jsonl' },
    { bytes: 2048, mtime: 1700000001, path: '/a/c d.jsonl' },
  ])
  expect(parseStat('')).toEqual([])
  expect(parseStat('x y /p\n1 2 /q\n')).toEqual([{ bytes: 1, mtime: 2, path: '/q' }])
})

test('parseDu reads du -sk lines into bytes', () => {
  const m = parseDu('256000\t/x/one\n4\t/x/two\n')
  expect(m.get('/x/one')).toBe(256000 * 1024)
  expect(m.get('/x/two')).toBe(4096)
  expect(parseDu('x\t/x/bad\n').has('/x/bad')).toBe(false)
  expect(parseDu('8\t/x/tab\tname\n').get('/x/tab\tname')).toBe(8192)
})

const INSTALLED = {
  version: 2,
  plugins: {
    'claude-mem@thedotmack': [{ scope: 'user', installPath: '/c/plugins/cache/thedotmack/claude-mem/13.34.2', version: '13.34.2' }],
    'serena@claude-plugins-official': [
      { scope: 'user', installPath: '/c/plugins/cache/claude-plugins-official/serena/2.0.0' },
      { scope: 'project', installPath: '/c/plugins/cache/claude-plugins-official/serena/2.0.0/' },
    ],
  },
}

test('installPaths collects every installPath, trailing slash dropped', () => {
  expect([...installPaths(INSTALLED)].sort()).toEqual([
    '/c/plugins/cache/claude-plugins-official/serena/2.0.0',
    '/c/plugins/cache/thedotmack/claude-mem/13.34.2',
  ])
  expect(installPaths({}).size).toBe(0)
})

test('staleDirs flags uninstalled versions only when a sibling is installed', () => {
  const dirs = [
    '/c/plugins/cache/thedotmack/claude-mem/10.6.2',
    '/c/plugins/cache/thedotmack/claude-mem/13.34.2',
    '/c/plugins/cache/claude-plugins-official/serena/1.0.0',
    '/c/plugins/cache/claude-plugins-official/serena/2.0.0',
    '/c/plugins/cache/orphan-mp/never-installed/0.1.0',
  ]
  expect(staleDirs(dirs, installPaths(INSTALLED))).toEqual([
    '/c/plugins/cache/thedotmack/claude-mem/10.6.2',
    '/c/plugins/cache/claude-plugins-official/serena/1.0.0',
  ])
})

test('projectLabel strips the home prefix', () => {
  expect(projectLabel('-Users-sam-code-my-app')).toBe('code-my-app')
  expect(projectLabel('-Users-sam')).toBe('~')
})

const C = '/opt/hm/.claude'
const CACHE = `${C}/plugins/cache`
const NOW = 1_800_000_000_000 // epoch ms, same as the engine clock below
const AGO = (days: number) => NOW / 1000 - days * 86_400 // mtime in epoch seconds
const NO_NL = '-not -path *\n*' // a real newline inside the pattern

function io(t: Record<string, Reply | (() => Reply)>, files: Record<string, string> = {}): Io & { calls: string[] } {
  const { run, calls } = fake(t)
  return { run, calls, read: async p => files[p] ?? null, now: NOW }
}

const INSTALLED_JSON = JSON.stringify({ plugins: { 'claude-mem@thedotmack': [{ installPath: `${CACHE}/thedotmack/claude-mem/13.34.2` }] } })

// The config dir exists; every target finds something.
function fullIo() {
  return io(
    {
      'test -d': ok(),
      [`find ${CACHE} -mindepth 3 -maxdepth 3 -type d -not -path */temp_* ${NO_NL} -exec stat -f %m %N {} +`]: ok(`${AGO(10)} ${CACHE}/thedotmack/claude-mem/10.6.2\n${AGO(0)} ${CACHE}/thedotmack/claude-mem/13.34.2\n`),
      [`find ${CACHE} -mindepth 4 -maxdepth 4 -name .orphaned_at ${NO_NL}`]: ok(''),
      [`du -sk ${CACHE}/thedotmack/claude-mem/10.6.2`]: ok(`256000\t${CACHE}/thedotmack/claude-mem/10.6.2\n`),
      [`find ${CACHE} -mindepth 1 -maxdepth 1 ( -name temp_git_* -o -name temp_subdir_* ) -mtime +0 ${NO_NL}`]: ok(`${CACHE}/temp_git_1\n${CACHE}/temp_subdir_2.clone\n`),
      [`du -sk ${CACHE}/temp_git_1`]: ok(`1024\t${CACHE}/temp_git_1\n3072\t${CACHE}/temp_subdir_2.clone\n`),
      [`find ${C}/file-history -type f -mtime +30 ${NO_NL} -exec stat -f %z %m %N {} +`]: ok(`100 1700000000 ${C}/file-history/a\n200 1690000000 ${C}/file-history/b\n`),
      [`find ${C}/debug -type f -mtime +7 ${NO_NL} -exec stat -f %z %m %N {} +`]: ok(''),
      [`find ${C}/projects`]: ok(`5000 1700000000 ${C}/projects/-Users-me-my-app/s1.jsonl\n6000 1695000000 ${C}/projects/-Users-me-my-app/s2.jsonl\n700 1700000000 ${C}/projects/-Users-me/s3.jsonl\n`),
    },
    { [`${C}/plugins/installed_plugins.json`]: INSTALLED_JSON },
  )
}

test('scan finds every target in the config dir', async () => {
  const x = fullIo()
  const { candidates, notes, error } = await scan(x, [C], 14)
  expect(error).toBeUndefined()
  expect(notes).toEqual([])
  const byLabel = Object.fromEntries(candidates.map(c => [c.label, c]))

  expect(byLabel['claude-mem 10.6.2']).toMatchObject({ dir: C, group: 'stale plugin versions', tier: 'safe', reason: 'not installed, 13.34.2 is; untouched 10d', bytes: 256000 * 1024, paths: [`${CACHE}/thedotmack/claude-mem/10.6.2`] })
  expect(byLabel['2 temp clones']).toMatchObject({ tier: 'safe', bytes: 4096 * 1024, paths: [`${CACHE}/temp_git_1`, `${CACHE}/temp_subdir_2.clone`] })
  expect(byLabel['file-history']).toMatchObject({ tier: 'safe', bytes: 300, reason: '2 files older than 30d, oldest 2023-07-22', paths: [`${C}/file-history/a`, `${C}/file-history/b`] })
  expect(byLabel['debug']).toBeUndefined()
  expect(byLabel['my-app']).toMatchObject({ group: 'old transcripts', tier: 'look', bytes: 11000, reason: '2 files older than 14d, oldest 2023-09-18' })
  expect(byLabel['~']).toMatchObject({ tier: 'look', bytes: 700 })
  expect(candidates.every(c => !c.ticked)).toBe(true)
  expect(x.calls.some(c => c === `find ${C}/projects -name *.jsonl -type f -mtime +14 ${NO_NL} -exec stat -f %z %m %N {} +`)).toBe(true)
})

test('scan flags a stale version 1d after Claude orphans it, or 7d untouched', async () => {
  const v = (n: string) => `${CACHE}/thedotmack/claude-mem/${n}`
  const x = io(
    {
      'test -d': ok(),
      find: ok(''),
      [`find ${CACHE} -mindepth 3`]: ok([`${AGO(0)} ${v('13.34.2')}`, `${AGO(2)} ${v('1-marked-2d')}`, `${NOW / 1000 - 3600} ${v('2-marked-1h')}`, `${AGO(10)} ${v('3-plain-10d')}`, `${AGO(3)} ${v('4-plain-3d')}`].join('\n')),
      [`find ${CACHE} -mindepth 4`]: ok(`${v('1-marked-2d')}/.orphaned_at\n${v('2-marked-1h')}/.orphaned_at\n`),
      'du -sk': ok(''),
    },
    { [`${C}/plugins/installed_plugins.json`]: INSTALLED_JSON },
  )
  const r = await scan(x, [C], 14)
  expect(r.error).toBeUndefined()
  expect(r.candidates.map(c => [c.label, c.reason])).toEqual([
    ['claude-mem 1-marked-2d', 'not installed, 13.34.2 is; orphaned 2d ago'],
    ['claude-mem 3-plain-10d', 'not installed, 13.34.2 is; untouched 10d'],
  ])
})

test('scan refuses a forged path from find output and lists nothing', async () => {
  const run = (reply: string) => scan(io({ 'test -d': ok(), find: ok(''), [`find ${C}/file-history`]: ok(reply), 'du -sk': ok('') }, { [`${C}/plugins/installed_plugins.json`]: INSTALLED_JSON }), [C], 14)
  const hostile = await run('5 1700000000 /opt/hm/.claude/file-history/a\n0 0 /etc/nobody\n')
  expect(hostile.candidates).toEqual([])
  expect(hostile.error).toContain('/etc/nobody')
  const dots = await run(`5 1700000000 ${C}/file-history/../../../etc/passwd\n`)
  expect(dots.candidates).toEqual([])
  expect(dots.error).toContain('/etc/passwd')
  const malformed = await run(`x y /p\n5 1700000000 ${C}/file-history/a\n`)
  expect(malformed.error).toBeUndefined()
  expect(malformed.candidates.map(c => c.paths)).toEqual([[`${C}/file-history/a`]])
})

test('scan skips a missing subfolder without running find on it', async () => {
  const x = io({ 'test -d': ok(), [`test -d ${C}/debug`]: { exitCode: 1, stdout: '' }, find: ok(''), 'du -sk': ok('') }, { [`${C}/plugins/installed_plugins.json`]: INSTALLED_JSON })
  const r = await scan(x, [C], 14)
  expect(r.error).toBeUndefined()
  expect(x.calls.some(c => c.startsWith(`find ${C}/debug`))).toBe(false)
  expect(r.candidates.some(c => c.group === 'debug')).toBe(false)
})

test('scan handles a very large file-history listing', async () => {
  const n = 200000
  const out = Array.from({ length: n }, (_, i) => `10 ${1700000000 + i} ${C}/file-history/f${i}`).join('\n') + '\n'
  const x = io({ 'test -d': ok(), find: ok(''), [`find ${C}/file-history`]: ok(out), 'du -sk': ok('') }, { [`${C}/plugins/installed_plugins.json`]: INSTALLED_JSON })
  const r = await scan(x, [C], 14)
  expect(r.error).toBeUndefined()
  const fh = r.candidates.find(c => c.group === 'file-history')!
  expect(fh.paths.length).toBe(n)
  expect(fh.bytes).toBe(n * 10)
  expect(fh.reason).toContain('oldest 2023-11-14')
})

test('scan notes an unreadable installed_plugins.json and still runs the other targets', async () => {
  const x = io({ 'test -d': ok(), find: ok(''), 'du -sk': ok('') }, { [`${C}/plugins/installed_plugins.json`]: '{not json' })
  const r = await scan(x, [C], 14)
  expect(r.error).toBeUndefined()
  expect(r.notes).toEqual([`${C}: installed_plugins.json unreadable, stale versions skipped`])
  expect(r.candidates).toEqual([])
})

test('scan reports a failing find as an error', async () => {
  const x = io({ 'test -d': ok(), find: { exitCode: 1, stdout: '', stderr: 'find: permission denied' } }, { [`${C}/plugins/installed_plugins.json`]: INSTALLED_JSON })
  const r = await scan(x, [C], 14)
  expect(r.error).toContain('permission denied')
})

test('order puts safe first, then larger first', () => {
  const c = (label: string, tier: Tier, bytes: number) => ({ id: label, dir: '', group: '', tier, label, reason: '', paths: [], bytes, ticked: false })
  expect(order([c('a', 'look', 9), c('b', 'safe', 1), c('c', 'safe', 5)]).map(x => x.label)).toEqual(['c', 'b', 'a'])
})

test('table has one row per group and a size column for the config dir', () => {
  const c = (group: string, tier: Tier, bytes: number) => ({ id: group, dir: C, group, tier, label: '', reason: '', paths: [], bytes, ticked: false })
  const out = table([c('stale plugin versions', 'safe', 250 * 1024 ** 2), c('old transcripts', 'look', 630 * 1024 ** 2)], [C])
  const [head, r1, r2] = out.split('\n')
  expect(head).toMatch(/^group\s+\.claude\s+tier$/)
  expect(r1).toMatch(/^stale plugin versions\s+250M\s+safe$/)
  expect(r2).toMatch(/^old transcripts\s+630M\s+look$/)
  expect(out.split('\n').length).toBe(3)
})

// Command tests go through the engine, so mock the process.run hook with the same table.
function shell(on: any, t: Record<string, Reply | (() => Reply)>) {
  const { run, calls } = fake(t)
  on('process.run', async (_$: any, e: any) => ({ value: { stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...(await run(e.argv)) } }))
  return calls
}

// `extra` keys come after the defaults, so they win in shell()'s prefix match. Register process.run once per test.
function engine(on: any, free: string, files: Record<string, string> = {}, extra: Record<string, Reply | (() => Reply)> = {}, store: Record<string, unknown> = {}) {
  mock.store(on, store)
  mock.clock(on, { now: 1_800_000_000_000 })
  const ui: { status?: string; toasts: string[] } = { toasts: [] }
  on('session.start', async (_$: any, e: any) => e)
  on('command.register', async () => ({ value: undefined }))
  on('env.get', async (_$: any, e: any) => ({ value: ({ HOME: '/opt/hm', CLAUDE_PLUGIN_DATA: '/data' } as Record<string, string>)[e.name] }))
  const written: Record<string, string> = {}
  on('fs.read', async (_$: any, e: any) => (e.path in written ? { value: written[e.path] } : e.path in files ? { value: files[e.path] } : Promise.reject(new Error('ENOENT'))))
  on('fs.write', async (_$: any, e: any) => { written[e.path] = e.text; return { value: undefined } })
  on('ui.status', async (_$: any, e: any) => { ui.status = e.text; return { value: undefined } })
  on('ui.render', { component: 'AbovePrompt' }, async ($: any, e: any) => $.ui.resolve(e).Text({ children: 'base' }) as any) // base layer under the band
  on('ui.toast', async (_$: any, e: any) => { ui.toasts.push(e.text); return { value: undefined } })
  const calls = shell(on, { uname: ok('Darwin\n'), 'df -k': ok(free), 'test -d': ok(), find: ok(''), 'du -sk': ok(''), 'rm -rf': ok(), ...extra })
  return { ui, calls, written }
}

const INSTALLED_FILES = { '/opt/hm/.claude/plugins/installed_plugins.json': INSTALLED_JSON }

const LOW = 'Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/x 1 1 26214400 86% /\n'
const HIGH = 'Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/x 1 1 104857600 50% /\n'

test('session.start warns once a day below 30 GB and stays quiet above', async ($, on) => {
  const { ui } = engine(on, LOW, INSTALLED_FILES)
  await $.session.start({ source: 'startup', cwd: '/repo' } as any)
  expect(ui.status).toBe('💽 25.0G free · /disk')
  expect(ui.toasts).toEqual(['Disk low: 25.0G free. Run /disk to sweep Claude data.'])
  await $.session.start({ source: 'startup', cwd: '/repo' } as any)
  expect(ui.toasts.length).toBe(1)
})

test('session.start above the threshold sets nothing', async ($, on) => {
  const { ui } = engine(on, HIGH, INSTALLED_FILES)
  await $.session.start({ source: 'startup', cwd: '/repo' } as any)
  expect(ui.status).toBeUndefined()
  expect(ui.toasts).toEqual([])
})

test('session.start does nothing off macOS', async ($, on) => {
  const { ui, calls } = engine(on, LOW, INSTALLED_FILES, { uname: ok('Linux\n') })
  await $.session.start({ source: 'startup', cwd: '/repo' } as any)
  expect(ui.status).toBeUndefined()
  expect(ui.toasts).toEqual([])
  expect(calls.some(c => c.startsWith('df'))).toBe(false)
})

test('/disk reports an error, not candidates, when find output was cut off', async ($, on) => {
  engine(on, HIGH, INSTALLED_FILES, { find: { exitCode: 0, stdout: `5 1700000000 ${C}/projects/x`, isStdoutTruncated: true } as any })
  await start($)
  const text = (await $.command.run({ command: 'disk', args: '' } as any)).text
  expect(text).toContain('output too large')
})

test('/disk with nothing to find says so; with a hit it returns the table', async ($, on) => {
  let hit = false
  const { calls } = engine(on, HIGH, INSTALLED_FILES, { 'find /opt/hm/.claude/file-history': () => ok(hit ? '100 1700000000 /opt/hm/.claude/file-history/a\n' : '') })
  await $.session.start({ source: 'startup', cwd: '/repo' } as any)
  expect((await $.command.run({ command: 'disk', args: '' } as any)).text).toBe('Nothing to sweep.')
  expect(calls.some(c => c.startsWith('find /opt/hm/.claude/projects') && c.includes('-mtime +14'))).toBe(true)

  hit = true
  const text = (await $.command.run({ command: 'disk', args: '--days 30' } as any)).text
  expect(text).toContain('file-history')
  expect(text).toContain('safe')
  expect(calls.some(c => c.includes('-mtime +30'))).toBe(true)
})

test('rm removes in chunks of 200 and returns the first error', async () => {
  const many = Array.from({ length: 450 }, (_, i) => `/f/${i}`)
  const { run, calls } = fake({ 'rm -rf': ok() })
  expect(await rm(run, many)).toBeNull()
  expect(calls.length).toBe(3)
  expect(calls[0]!.split(' ').length).toBe(203)
  expect(calls[2]!.split(' ').length).toBe(53)
  expect(calls[0]!.startsWith('rm -rf -- /f/0 ')).toBe(true)

  const bad = fake({ 'rm -rf': { exitCode: 1, stdout: '', stderr: 'rm: /f/1: Operation not permitted' } })
  expect(await rm(bad.run, ['/f/1'])).toBe('rm: /f/1: Operation not permitted')
  expect(await rm(fake({}).run, ['/f/1'])).toBe('rm exit 127')
})

const props = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 20 }, view: {} }
const mount = ($: any) => $.ui.mount({ plugin: 'disk-sweep', surface: 'terminal', component: 'AbovePrompt', props })
const start = ($: any) => $.session.start({ source: 'startup', cwd: '/repo' } as any)

// The rescan on Confirm still finds these files, at these sizes.
const FH = [`${C}/file-history/a`, `${C}/file-history/b`]
const T = `${C}/projects/-Users-me-x/t.jsonl`
const STILL_THERE = {
  [`find ${C}/file-history`]: ok(FH.map(p => `${1.5 * GB} 1700000000 ${p}`).join('\n')),
  [`find ${C}/projects`]: ok(`${GB} 1700000000 ${T}\n`),
}

test('tick, tick all safe, confirm twice removes and reports freed', { options: { dryRun: false, deleteRoots: '~/.claude' } }, async ($, on) => {
  const safe = { id: 's', dir: C, group: 'g', tier: 'safe' as const, label: 'safe one', reason: '', paths: FH, bytes: 3 * GB, ticked: false }
  const look = { id: 'l', dir: C, group: 'g', tier: 'look' as const, label: 'look one', reason: '', paths: [T], bytes: 1 * GB, ticked: false }
  const { ui, calls } = engine(on, HIGH, INSTALLED_FILES, STILL_THERE, { scan: { at: '2026-10-13T00:00:00.000Z', days: 14, candidates: [safe, look] } })
  await start($)
  let band = await mount($)
  expect(await band.findAll({ type: 'Button', text: /Tick/ })).toHaveLength(3) // two rows plus Tick all safe
  expect(await band.find({ type: 'Button', text: /Remove ticked \(0, 0K\)/ })).toBeDefined()

  await band.press({ key: 't-l' })
  band = await mount($)
  expect(await band.findAll({ type: 'Button', text: /Untick/ })).toHaveLength(1)
  await band.press({ key: 't-l' })
  band = await mount($)
  expect(await band.findAll({ type: 'Button', text: /Untick/ })).toHaveLength(0)

  await band.press({ key: 'all-safe' })
  band = await mount($)
  expect(await band.findAll({ type: 'Button', text: /Untick/ })).toHaveLength(1)
  expect(await band.find({ type: 'Button', text: /Remove ticked \(1, 3\.0G\)/ })).toBeDefined()

  await band.press({ key: 'remove' })
  band = await mount($)
  expect(await band.find({ type: 'Button', text: /Confirm 3\.0G\?/ })).toBeDefined()
  expect(calls.some(c => c.startsWith('rm'))).toBe(false)

  await band.press({ key: 't-l' })
  band = await mount($)
  expect(await band.find({ type: 'Button', text: /Confirm/ })).toBeUndefined()
  expect(await band.find({ type: 'Button', text: /Remove ticked \(2, 4\.0G\)/ })).toBeDefined()

  await band.press({ key: 'remove' })
  await band.press({ key: 'remove' })
  expect(calls).toContain(`rm -rf -- ${FH.join(' ')}`)
  expect(calls).toContain(`rm -rf -- ${T}`)
  expect(ui.status).toBe('💽 freed 4.0G')
  band = await mount($)
  expect(await band.find({ type: 'Button', text: /Remove/ })).toBeUndefined()
})

test('a failed rm keeps the row with the error as its reason and leaves the status alone', { options: { dryRun: false, deleteRoots: '~/.claude' } }, async ($, on) => {
  const row = { id: 'x', dir: C, group: 'g', tier: 'safe' as const, label: 'x', reason: 'old', paths: [T], bytes: GB, ticked: true }
  const { ui } = engine(on, LOW, INSTALLED_FILES, { ...STILL_THERE, 'rm -rf': { exitCode: 1, stdout: '', stderr: 'rm: busy' } }, { scan: { at: '', days: 14, candidates: [row] } })
  await start($)
  let band = await mount($)
  await band.press({ key: 'remove' })
  await band.press({ key: 'remove' })
  band = await mount($)
  expect(await band.find({ text: /rm failed: rm: busy/ })).toBeDefined()
  expect(await band.find({ type: 'Button', text: /Untick/ })).toBeUndefined()
  expect(ui.status).toBe('💽 25.0G free · /disk')
})

test('Confirm rescans: a ticked row the fresh scan no longer finds is dropped without rm', async ($, on) => {
  const row = { id: 'x', dir: C, group: 'g', tier: 'safe' as const, label: 'x', reason: 'old', paths: [T], bytes: GB, ticked: true }
  const { ui, calls } = engine(on, HIGH, INSTALLED_FILES, {}, { scan: { at: '', days: 14, candidates: [row] } })
  await start($)
  let band = await mount($)
  await band.press({ key: 'remove' })
  await band.press({ key: 'remove' })
  expect(calls.some(c => c.startsWith('rm'))).toBe(false)
  expect(calls.some(c => c.startsWith(`find ${C}/projects`))).toBe(true)
  expect(ui.status).toBeUndefined()
  band = await mount($)
  expect(await band.find({ type: 'Button', text: /Remove/ })).toBeUndefined()
})

test('Confirm with a failing rescan keeps the band, toasts the error and deletes nothing', async ($, on) => {
  const row = { id: 'x', dir: C, group: 'g', tier: 'safe' as const, label: 'x', reason: 'old', paths: [T], bytes: GB, ticked: true }
  const { ui, calls } = engine(on, HIGH, INSTALLED_FILES, { find: { exitCode: 1, stdout: '', stderr: 'find: permission denied' } }, { scan: { at: '', days: 14, candidates: [row] } })
  await start($)
  let band = await mount($)
  await band.press({ key: 'remove' })
  await band.press({ key: 'remove' })
  expect(calls.some(c => c.startsWith('rm'))).toBe(false)
  expect(ui.toasts.some(t => t.includes('permission denied'))).toBe(true)
  band = await mount($)
  expect(await band.find({ type: 'Button', text: /Remove ticked \(1/ })).toBeDefined()
})

test('Dismiss clears the band', async ($, on) => {
  const row = { id: 'x', dir: C, group: 'g', tier: 'safe' as const, label: 'x', reason: 'old', paths: ['/c/x'], bytes: GB, ticked: false }
  engine(on, HIGH, INSTALLED_FILES, {}, { scan: { at: '', days: 14, candidates: [row] } })
  await start($)
  let band = await mount($)
  expect(await band.find({ type: 'Button', text: /Remove/ })).toBeDefined()
  await band.press({ key: 'dismiss' })
  band = await mount($)
  expect(await band.find({ type: 'Button', text: /Remove/ })).toBeUndefined()
})

// A temporary HOME (/opt/hm) held in memory: find lists the files that still exist, rm -rf really drops them.
const W = '/opt/hm/.claude-work'
function tempHome(on: any, userConfigFiles: string[]) {
  const live = new Set(userConfigFiles)
  const list = (dir: string) => ok([...live].filter(p => p.startsWith(`${dir}/file-history/`)).map(p => `1000 1700000000 ${p}`).join('\n'))
  let calls: string[] = []
  const e = engine(on, HIGH, INSTALLED_FILES, {
    [`find ${C}/file-history`]: () => list(C),
    [`find ${W}/file-history`]: () => list(W),
    'rm -rf': () => {
      for (const p of calls.at(-1)!.replace('rm -rf -- ', '').split(' ')) live.delete(p)
      return ok()
    },
  })
  calls = e.calls
  return { ...e, live }
}

async function sweepEverything($: any) {
  await start($)
  await $.command.run({ command: 'disk', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  const band = await mount($)
  await band.press({ key: 'all-safe' })
  await band.press({ key: 'remove' })
  await band.press({ key: 'remove' })
}

const IN = `${C}/file-history/old`
const OUT = `${W}/file-history/old`
const logOf = (written: Record<string, string>) => written['/data/disk-sweep.log'] ?? ''

test('temporary HOME, default options: nothing is deleted and the log says it was skipped', async ($, on) => {
  const h = tempHome(on, [IN])
  await sweepEverything($)
  expect(h.live.has(IN)).toBe(true)
  expect(h.calls.some(c => c.startsWith('rm'))).toBe(false)
  expect(logOf(h.written)).toContain(`skipped (not under deleteRoots) ${IN}`)
})

test('temporary HOME, dryRun off but deleteRoots empty: nothing is deleted', { options: { dryRun: false } }, async ($, on) => {
  const h = tempHome(on, [IN])
  await sweepEverything($)
  expect(h.live.has(IN)).toBe(true)
  expect(h.calls.some(c => c.startsWith('rm'))).toBe(false)
  expect(h.ui.toasts.join('\n')).toContain('deleteRoots')
})

test('temporary HOME, dryRun on even with deleteRoots listed: nothing is deleted', { options: { dryRun: true, deleteRoots: '~/.claude' } }, async ($, on) => {
  const h = tempHome(on, [IN])
  await sweepEverything($)
  expect(h.live.has(IN)).toBe(true)
  expect(h.calls.some(c => c.startsWith('rm'))).toBe(false)
  expect(logOf(h.written)).toContain(`would remove ${IN}`)
  expect(h.ui.toasts.join('\n')).toContain('dry run')
})

test('temporary HOME, dryRun off: deletes only under deleteRoots and logs every action', { options: { dryRun: false, deleteRoots: '~/.claude', alsoSweep: '~/.claude-work' } }, async ($, on) => {
  const h = tempHome(on, [IN, OUT])
  await sweepEverything($)
  expect(h.live.has(IN)).toBe(false)
  expect(h.live.has(OUT)).toBe(true) // scanned through alsoSweep, but not a delete root
  const log = logOf(h.written)
  expect(log).toContain(`removing ${IN}`)
  expect(log).toContain('removed 1 item(s)')
  expect(log).toContain(`skipped (not under deleteRoots) ${OUT}`)
})
