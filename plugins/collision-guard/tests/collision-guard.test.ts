import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const
const NOW = 10_000_000

// Stands for the engine: file mtimes, the asked questions, and the edits that ran.
const host = (on: On, mtimes: Record<string, number>, answer = 'Proceed', brokenClock = false) => {
  const seen = { asks: [] as string[], edits: [] as string[] }
  if (brokenClock) {
    on('clock.now', () => {
      throw new Error('no clock')
    })
  } else {
    mock.clock(on, { now: NOW })
  }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.stat', (_, e) => {
    const m = mtimes[e.path]
    if (m === undefined) throw new Error('ENOENT')
    return { value: { kind: 'file', size: 1, mtimeMs: m, isLink: false } }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
    seen.asks.push(e.questions[0].question)
    return { result: { questions: e.questions, answers: { [e.questions[0].question]: answer } }, text: '' }
  })
  on('tool.call', { tool: 'Edit' }, (_, e) => {
    seen.edits.push(e.file_path)
    mtimes[e.file_path] = NOW + 1
    return { result: {}, text: 'ok' }
  })

  return seen
}

const edit = ($: Parameters<Parameters<typeof test>[1]>[0], file_path: string) =>
  $.tool.call({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b' })

test('a file changed 5 minutes ago asks first; Cancel denies the edit', async ($, on) => {
  const seen = host(on, { '/r/a.md': NOW - 5 * 60_000 }, 'Cancel')
  await $.session.start(START)
  const out = await edit($, '/r/a.md')
  expect(seen.asks).toHaveLength(1)
  expect(seen.edits).toEqual([])
  expect(JSON.stringify(out)).toContain('collision-guard')
})

test('Proceed edits, and the session own write is not asked about again', async ($, on) => {
  const seen = host(on, { '/r/a.md': NOW - 5 * 60_000 })
  await $.session.start(START)
  await edit($, '/r/a.md')
  await edit($, '/r/a.md')
  expect(seen.asks).toHaveLength(1)
  expect(seen.edits).toEqual(['/r/a.md', '/r/a.md'])
})

test('an old file, and a new file, edit without asking', async ($, on) => {
  const seen = host(on, { '/r/old.md': NOW - 3 * 60 * 60_000 })
  await $.session.start(START)
  await edit($, '/r/old.md')
  await edit($, '/r/new.md')
  expect(seen.asks).toEqual([])
  expect(seen.edits).toEqual(['/r/old.md', '/r/new.md'])
})

test('unattended mode: edits proceed without asking, and the prompt does not claim another session', async ($, on) => {
  const seen = host(on, { '/r/a.md': NOW - 5 * 60_000, '/r/b.md': NOW - 5 * 60_000 })
  let unattended = true
  on('state.get', (_, e) => ({ value: { value: e.plugin === 'unattended' ? unattended : undefined, version: 1 } }))
  await $.session.start(START)
  const out = await edit($, '/r/a.md')
  expect(seen.asks).toEqual([])
  expect(seen.edits).toEqual(['/r/a.md'])
  expect(JSON.stringify(out)).not.toContain('chose not to edit')

  unattended = false
  await edit($, '/r/b.md')
  expect(seen.asks).toHaveLength(1)
  expect(seen.asks[0]).toContain("outside this session's edits")
})

test('a failing check never blocks the edit', async ($, on) => {
  const seen = host(on, { '/r/a.md': NOW - 5 * 60_000 })
  on('state.get', () => {
    throw new Error('state unavailable')
  })
  await $.session.start(START)
  await edit($, '/r/a.md')
  expect(seen.edits).toEqual(['/r/a.md'])
})

test('a broken clock never blocks the edit', async ($, on) => {
  const seen = host(on, { '/r/a.md': NOW - 5 * 60_000 }, 'Proceed', true)
  await $.session.start(START)
  await edit($, '/r/a.md')
  expect(seen.edits).toEqual(['/r/a.md'])
})
