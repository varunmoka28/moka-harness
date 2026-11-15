import { expect, mock, test } from 'claude-code/testing'

test('records this session for the desk pane and warns on a shared edit', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/h' })
  const files = new Map<string, string>()
  const dir = '/h/.claude/session-peers/%2Frepo'
  const toasts: string[] = []
  on('session.root', async () => ({ value: '/repo' }))
  on('session.id', async () => ({ value: 'me' }) as any)
  on('session.start', async (_$, e) => e as any)
  on('session.end', async () => ({ sessionId: 'me' }) as any)
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }) as any)
  on('turn.complete', async (_$, e) => ({ text: e.answer }) as any)
  on('fs.write', async (_$, e) => (files.set(e.path, e.text), { value: undefined }) as any)
  on('fs.read', async (_$, e) => {
    if (!files.has(e.path)) throw new Error('missing')
    return { value: files.get(e.path)! } as any
  })
  on('fs.list', async (_$, e) => ({
    value: [...files.keys()].filter(p => p.startsWith(`${e.path}/`)).map(p => ({ name: p.slice(e.path.length + 1), kind: 'file', size: 1, mtimeMs: 0, isLink: false })),
  }) as any)
  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'rm') for (const p of e.argv.slice(2)) files.delete(p)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', async (_$, e) => (toasts.push(e.text), { value: undefined }) as any)
  // stands in for core running the tool
  on('tool.call', async () => ({ result: {} }) as any)

  const mine = () => JSON.parse(files.get(`${dir}/me.json`)!)

  await $.session.start({ source: 'startup', cwd: '/repo', isInteractive: true } as any)
  expect(mine().status).toBe('done')

  // another tab in the same folder, mid-turn, has edited a.ts; a third one is long dead
  files.set(`${dir}/b.json`, JSON.stringify({ id: 'b', label: 'fix the loader', status: 'working', seen: clock.now(), edits: { '/repo/a.ts': 1 }, tab: 'w1:t2' }))
  files.set(`${dir}/bot.json`, JSON.stringify({ id: 'bot', label: 'background observer', status: 'working', seen: clock.now(), edits: {}, headless: true }))
  files.set(`${dir}/gone.json`, JSON.stringify({ id: 'gone', label: 'closed tab', status: 'done', seen: clock.now(), edits: {}, ended: true }))
  files.set(`${dir}/old.json`, JSON.stringify({ id: 'old', label: 'stale tab', status: 'done', seen: 0, edits: {} }))
  // each row names its session by the first 8 characters of the id
  files.set(`${dir}/c.json`, JSON.stringify({ id: '2b345a0f-886d-4542-b2a8-227aa6d9ebcc', label: 'save the session', status: 'done', seen: clock.now(), edits: {} }))
  await $.turn.start({ text: 'refactor a.ts\nmore', turnId: 't1' } as any)
  expect(mine()).toMatchObject({ status: 'working', label: 'refactor a.ts' })

  // editing a file the other session also edited warns; an unshared file does not
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'x', new_string: 'y' } as any)
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toMatch(/a\.ts is also being edited by "fix the loader"/)
  expect(mine().edits['/repo/a.ts']).toBeDefined()
  await $.tool.call({ tool: 'Write', file_path: '/repo/b.ts', content: '' } as any)
  expect(toasts).toHaveLength(1)

  // ended and long-silent peers are cleaned up; live ones stay
  expect(files.has(`${dir}/gone.json`)).toBe(false)
  expect(files.has(`${dir}/old.json`)).toBe(false)
  expect(files.has(`${dir}/b.json`)).toBe(true)

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1' } as any)
  expect(mine().status).toBe('done')

  // a finished background task starts a turn with a <task-notification> block: the label is its summary
  const note = '<task-notification>\n<task-id>b2bmzo4s6</task-id>\n<status>completed</status>\n<summary>Background command "Commit" completed</summary>\n</task-notification>'
  await $.turn.start({ text: note, turnId: 't2' } as any)
  expect(mine()).toMatchObject({ status: 'working', label: 'Background command "Commit" completed' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2' } as any)

  await $.session.end({ reason: 'exit' } as any)
  expect(files.has(`${dir}/me.json`)).toBe(false)
})

test('after a /clear the record is written again under the new session id', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/h', HERDR_TAB_ID: 'w3X:t1' })
  const files = new Map<string, string>()
  const dir = '/h/.claude/session-peers/%2Frepo'
  let id = 'old'
  on('session.root', async () => ({ value: '/repo' }))
  on('session.id', async () => ({ value: id }) as any)
  on('session.start', async (_$, e) => e as any)
  // core moves the process to a new id as the cleared conversation ends; no session.start follows
  on('session.end', async () => ((id = 'new'), { sessionId: 'old' }) as any)
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }) as any)
  on('fs.write', async (_$, e) => (files.set(e.path, e.text), { value: undefined }) as any)
  on('fs.read', async (_$, e) => {
    if (!files.has(e.path)) throw new Error('missing')
    return { value: files.get(e.path)! } as any
  })
  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'rm') for (const p of e.argv.slice(2)) files.delete(p)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  await $.session.start({ source: 'startup', cwd: '/repo', isInteractive: true } as any)
  await $.turn.start({ text: 'before the clear', turnId: 't1' } as any)
  await $.session.end({ reason: 'clear', sessionId: 'old' } as any)
  expect(files.has(`${dir}/old.json`)).toBe(false)
  expect(JSON.parse(files.get(`${dir}/new.json`)!)).toMatchObject({ id: 'new', label: 'new session', tab: 'w3X:t1' })
  expect(JSON.parse(files.get(`${dir}/new.json`)!).ended).toBeFalsy()

  await $.turn.start({ text: 'after the clear', turnId: 't2' } as any)
  expect(JSON.parse(files.get(`${dir}/new.json`)!)).toMatchObject({ status: 'working', label: 'after the clear' })
  // the 30 s heartbeat keeps running for the new id
  const seen = JSON.parse(files.get(`${dir}/new.json`)!).seen
  await clock.advance(30_000)
  expect(JSON.parse(files.get(`${dir}/new.json`)!).seen).toBeGreaterThan(seen)
})

test('the record goes under CLAUDE_CONFIG_DIR when it is set', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/h', CLAUDE_CONFIG_DIR: '/cfg' })
  const files = new Map<string, string>()
  on('session.root', async () => ({ value: '/repo' }))
  on('session.id', async () => ({ value: 'me' }) as any)
  on('session.start', async (_$, e) => e as any)
  on('fs.write', async (_$, e) => (files.set(e.path, e.text), { value: undefined }) as any)
  on('fs.read', async () => {
    throw new Error('missing')
  })
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))

  await $.session.start({ source: 'startup', cwd: '/repo', isInteractive: true } as any)
  expect(files.has('/cfg/session-peers/%2Frepo/me.json')).toBe(true)
  expect([...files.keys()].some(k => k.startsWith('/h/'))).toBe(false)
})
