import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const OK = { exitCode: 0, stderr: '', signal: null, timedOut: false }
const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const
const SETTINGS = '/h/.claude/big-read-guard.json'

type Opts = { sizes?: Record<string, number>; lines?: Record<string, number>; settings?: string; settingsError?: string; statError?: string; directories?: string[]; awkFails?: boolean; awkOutput?: string }

// Stands for the file system, awk, popups and the Read tool: what was read and what popped up.
const host = (on: On, o: Opts = {}) => {
  const seen = { read: [] as string[], toasts: [] as string[] }
  mock.env(on, { HOME: '/h' })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.read', (_, e) => {
    if (e.path === SETTINGS && o.settingsError) return { deny: o.settingsError }
    if (e.path === SETTINGS && o.settings !== undefined) return { value: o.settings }
    return { deny: 'ENOENT: no such file or directory' }
  })
  on('fs.stat', (_, e) => {
    if (o.statError) return { deny: o.statError }
    if (o.directories?.includes(e.path)) return { value: { kind: 'directory', size: 0, mtimeMs: 0, isLink: false } }
    const size = o.sizes?.[e.path]
    if (size === undefined) return { deny: 'ENOENT: no such file or directory' }
    return { value: { kind: 'file', size, mtimeMs: 0, isLink: false } }
  })
  on('process.run', (_, e) => {
    if (o.awkFails) return { value: { ...OK, exitCode: 2, stdout: '', stderr: 'awk: boom' } }
    return { value: { ...OK, stdout: o.awkOutput ?? `${o.lines?.[e.argv[2]!] ?? 1}\n` } }
  })
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('tool.call', { tool: 'Read' }, (_, e) => {
    seen.read.push(e.file_path)
    return { result: {} } as never
  })

  return seen
}

type Engine = Parameters<Parameters<typeof test>[1]>[0]
const read = ($: Engine, file_path: string, extra = {}) => $.tool.call({ tool: 'Read', file_path, ...extra } as never) as Promise<any>
const BIG = 200 * 1024

test('a text file over 50 KB with no range is blocked with size, lines and the whole-file range', async ($, on) => {
  const seen = host(on, { sizes: { '/p/log.jsonl': BIG }, lines: { '/p/log.jsonl': 4200 } })
  await $.session.start(START)
  const out = await read($, '/p/log.jsonl')
  expect(seen.read).toEqual([])
  expect(out.deny).toBe('big-read-guard: /p/log.jsonl is 200 KB, 4200 lines. Grep for what you need, or Read with offset and limit. To read all of it on purpose: offset: 1, limit: 4200.')
})

test('exactly 51,200 bytes passes, one byte more is blocked', async ($, on) => {
  const seen = host(on, { sizes: { '/p/a.txt': 51_200, '/p/b.txt': 51_201 }, lines: { '/p/b.txt': 10 } })
  await $.session.start(START)
  await read($, '/p/a.txt')
  const out = await read($, '/p/b.txt')
  expect(seen.read).toEqual(['/p/a.txt'])
  expect(out.deny).toContain('/p/b.txt')
})

test('offset and limit together pass; either alone does not', async ($, on) => {
  const seen = host(on, { sizes: { '/p/big.txt': BIG }, lines: { '/p/big.txt': 9000 } })
  await $.session.start(START)
  await read($, '/p/big.txt', { offset: 1, limit: 9000 })
  expect((await read($, '/p/big.txt', { offset: 1 })).deny).toBeDefined()
  expect((await read($, '/p/big.txt', { limit: 50 })).deny).toBeDefined()
  expect(seen.read).toEqual(['/p/big.txt'])
})

test('built-in types pass whatever their size, matching ignores case', async ($, on) => {
  const files = ['/p/s.PNG', '/p/a.jpg', '/p/b.jpeg', '/p/c.gif', '/p/d.webp', '/p/e.pdf', '/p/f.ipynb']
  const seen = host(on, { sizes: Object.fromEntries(files.map(f => [f, BIG])) })
  await $.session.start(START)
  for (const f of files) await read($, f)
  expect(seen.read).toEqual(files)
})

test('types from the settings file are skipped, with or without the dot', async ($, on) => {
  const seen = host(on, { sizes: { '/p/d.CSV': BIG, '/p/e.log': BIG, '/p/f.txt': BIG }, settings: '{ "skip": [".csv", "log"] }' })
  await $.session.start(START)
  await read($, '/p/d.CSV')
  await read($, '/p/e.log')
  expect((await read($, '/p/f.txt')).deny).toBeDefined()
  expect(seen.read).toEqual(['/p/d.CSV', '/p/e.log'])
})

test('a small file and a directory pass', async ($, on) => {
  const seen = host(on, { sizes: { '/p/small.md': 6_000 }, directories: ['/p/dir'] })
  await $.session.start(START)
  await read($, '/p/small.md')
  await read($, '/p/dir')
  expect(seen.read).toEqual(['/p/small.md', '/p/dir'])
})

test('a missing file passes with no popup', async ($, on) => {
  const seen = host(on)
  await $.session.start(START)
  await read($, '/p/missing.txt')
  expect(seen.read).toEqual(['/p/missing.txt'])
  expect(seen.toasts).toEqual([])
})

test('a failing size check passes the read and pops up once per session', async ($, on) => {
  const o: Opts = { statError: 'EACCES: permission denied' }
  const seen = host(on, o)
  await $.session.start(START)
  await read($, '/p/a.txt')
  await read($, '/p/b.txt')
  expect(seen.read).toEqual(['/p/a.txt', '/p/b.txt'])
  expect(seen.toasts).toHaveLength(1)
  expect(seen.toasts[0]).toBe('big-read-guard: check failed on /p/a.txt, reads are not guarded: big-read-guard: $.fs.stat: EACCES: permission denied')
  await $.session.start(START)
  await read($, '/p/c.txt')
  expect(seen.toasts).toHaveLength(2)
  o.statError = undefined
  o.settingsError = 'EACCES: settings unreadable'
  o.sizes = { '/p/big.txt': BIG }
  await $.session.start(START)
  await read($, '/p/big.txt')
  expect(seen.read).toEqual(['/p/a.txt', '/p/b.txt', '/p/c.txt', '/p/big.txt'])
  expect(seen.toasts).toHaveLength(3)
  expect(seen.toasts[2]).toContain('EACCES: settings unreadable')
})

test('a failing line count passes the read and pops up', async ($, on) => {
  const o: Opts = { sizes: { '/p/big.txt': BIG }, awkFails: true }
  const seen = host(on, o)
  await $.session.start(START)
  await read($, '/p/big.txt')
  expect(seen.read).toEqual(['/p/big.txt'])
  expect(seen.toasts[0]).toContain('line count failed')
  o.awkFails = false
  for (const output of ['', '0\n', '-1\n', 'oops\n', '1.5\n']) {
    o.awkOutput = output
    await read($, '/p/big.txt')
  }
  expect(seen.read).toHaveLength(6)
  expect(seen.toasts).toHaveLength(1)
})

test('a broken settings file falls back to the built-in list with its own popup, once', async ($, on) => {
  const seen = host(on, { sizes: { '/p/d.csv': BIG, '/p/s.png': BIG }, lines: { '/p/d.csv': 3 }, settings: '{ skip: ' })
  await $.session.start(START)
  expect((await read($, '/p/d.csv')).deny).toBeDefined()
  await read($, '/p/s.png')
  await read($, '/p/d.csv')
  expect(seen.read).toEqual(['/p/s.png'])
  expect(seen.toasts).toHaveLength(1)
  expect(seen.toasts[0]).toContain('using the built-in skip list')
})

test('a settings file with the wrong shape counts as broken', async ($, on) => {
  const seen = host(on, { sizes: { '/p/d.csv': BIG }, lines: { '/p/d.csv': 3 }, settings: '{ "skip": ".csv" }' })
  await $.session.start(START)
  expect((await read($, '/p/d.csv')).deny).toBeDefined()
  expect(seen.toasts[0]).toContain('using the built-in skip list')
})

test('a ~/ path is checked at its real place under HOME', async ($, on) => {
  const seen = host(on, { sizes: { '/h/big.jsonl': BIG }, lines: { '/h/big.jsonl': 900 } })
  await $.session.start(START)
  const out = await read($, '~/big.jsonl')
  expect(seen.read).toEqual([])
  expect(out.deny).toBe('big-read-guard: ~/big.jsonl is 200 KB, 900 lines. Grep for what you need, or Read with offset and limit. To read all of it on purpose: offset: 1, limit: 900.')
})
