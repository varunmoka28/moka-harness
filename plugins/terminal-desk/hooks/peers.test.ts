import { expect, mock, test } from 'claude-code/testing'

test('the desk pane lists every terminal session, other folders tagged, and a click focuses that tab', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => $.ui.resolve(e).Box({}) as any) // the engine's own band, beneath
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/h' })
  // Live sessions come from Claude Code's registry; session-peers notes only add the label and tab.
  // A session in another folder (the repo's main checkout, a worktree) is a tab too; a `claude -p` run is not.
  const reg = '/h/.claude/sessions'
  const dir = '/h/.claude/session-peers/%2Frepo'
  const files = new Map<string, string>([
    [`${reg}/1.json`, JSON.stringify({ sessionId: 'me', cwd: '/repo', kind: 'interactive', entrypoint: 'cli', status: 'busy', name: 'repo-1' })],
    [`${reg}/2.json`, JSON.stringify({ sessionId: 'b', cwd: '/repo', kind: 'interactive', entrypoint: 'cli', status: 'busy', name: 'repo-2' })],
    [`${reg}/3.json`, JSON.stringify({ sessionId: 'x', cwd: '/repo/.claude/worktrees/elsewhere', kind: 'interactive', entrypoint: 'cli', status: 'busy', name: 'elsewhere-3' })],
    [`${reg}/4.json`, JSON.stringify({ sessionId: 'p', cwd: '/repo', kind: 'interactive', entrypoint: 'sdk-cli', status: 'busy', name: 'print run' })],
    // a record is first written before its entrypoint (and, for an observer, its final cwd) land
    [`${reg}/5.json`, JSON.stringify({ sessionId: 'o', cwd: '/h/.claude-mem/observer-sessions', kind: 'interactive', name: 'observer-sessions-9' })],
    [`${dir}/me.json`, JSON.stringify({ id: 'me', label: 'this one', status: 'working', seen: 1_000_000, edits: {} })],
    [`${dir}/b.json`, JSON.stringify({ id: 'b', label: 'fix the KB loader', status: 'working', seen: 1_000_000, edits: {}, tab: 'w1:t2' })],
    [`${dir}/old.json`, JSON.stringify({ id: 'old', label: 'stale tab', status: 'done', seen: 0, edits: {} })],
    ['/h/.claude/session-peers/%2Frepo%2F.claude%2Fworktrees%2Felsewhere/x.json', JSON.stringify({ id: 'x', label: 'worktree agent', status: 'working', seen: 1_000_000, edits: {}, tab: 'w2:t1' })],
  ])
  const ran: string[][] = []
  const opened: string[] = []
  const closed: string[] = []
  on('ui.open', async (_$, e) => (opened.push(e.id), { value: { isPlaced: true } }) as any)
  on('ui.close', async (_$, e) => (closed.push(e.id), { value: undefined }) as any)
  on('session.root', async () => ({ value: '/repo' }))
  on('session.id', async () => ({ value: 'me' }) as any)
  on('session.start', async (_$, e) => e as any)
  on('store.get', async () => ({ value: undefined }) as any)
  on('command.register', async () => ({ value: undefined }) as any)
  on('tool.register', async () => ({ value: undefined }) as any)
  on('fs.read', async (_$, e) => {
    if (!files.has(e.path)) throw new Error('missing')
    return { value: files.get(e.path)! } as any
  })
  on('fs.list', async (_$, e) => ({
    value: [...files.keys()].filter(p => p.startsWith(`${e.path}/`)).map(p => ({ name: p.slice(e.path.length + 1), kind: 'file', size: 1, mtimeMs: 0, isLink: false })),
  }) as any)
  on('process.run', async (_$, e) => (ran.push([...e.argv]), { value: { exitCode: 0, stdout: '', stderr: '' } }) as any)

  await $.session.start({ source: 'startup', cwd: '/repo', isInteractive: true } as any)
  await clock.advance(5_000)
  const ui = await $.ui.mount({ plugin: 'terminal-desk', surface: 'terminal', component: 'Pane', requestId: 'desk', props: { bodyColumns: 80, maxRows: 60 } } as any)
  expect(await ui.find({ text: /fix the KB loader/ })).toBeDefined()
  expect(await ui.find({ text: /\(this session\)/ })).toBeDefined()
  expect(await ui.find({ text: /stale tab/ })).toBeUndefined()
  expect(await ui.find({ text: /print run/ })).toBeUndefined()
  expect(await ui.find({ text: /observer-sessions/ })).toBeUndefined()
  // the other folder's row carries its label from that folder's note and the folder as its tag
  expect(await ui.find({ text: /worktree agent/ })).toBeDefined()
  expect(await ui.find({ text: /\(elsewhere\)/ })).toBeDefined()
  // each clickable row is its own keyed Box (the hover scope the pointer lights) holding the Button;
  // this session's row is plain text in an unkeyed-for-hover Box
  const rowB = await ui.find({ type: 'Box', key: 'row-b' })
  expect(rowB?.children).toHaveLength(1)
  expect((rowB?.children[0] as { props: { key: string } }).props.key).toBe('peer-b')
  expect(await ui.find({ type: 'Box', key: 'row-me' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'peer-me' })).toBeUndefined()
  await ui.press({ key: 'peer-b' })
  await ui.press({ key: 'peer-x' })
  // `tail` calls read each session's context size; only the focus matters here
  expect(ran.filter(argv => argv[1] === 'tab')).toEqual([['herdr', 'tab', 'focus', 'w1:t2'], ['herdr', 'tab', 'focus', 'w2:t1']])

  // the stats bar above the prompt counts them, and pressing the count opens the desk pane
  const bar = await $.ui.mount({ plugin: 'terminal-desk', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 200, scroll: { offset: 0, bodyRows: 10 }, view: {} } } as any)
  expect(await bar.find({ text: /2 other ▸ desk/ })).toBeDefined()
  expect(await bar.find({ text: /0 read · 0 written/ })).toBeDefined()
  await bar.press({ key: 'open-desk' })
  expect(opened).toEqual(['desk'])
  expect(await bar.find({ text: /2 other ▾ desk/ })).toBeDefined()
  // a second press closes it, and the bar goes back to closed
  await bar.press({ key: 'open-desk' })
  expect(closed).toEqual(['desk'])
  expect(opened).toEqual(['desk'])
  expect(await bar.find({ text: /2 other ▸ desk/ })).toBeDefined()
})

test('an unchanged peer transcript is not read again', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/h' })
  const reg = '/h/.claude/sessions'
  const files = new Map<string, string>([
    [`${reg}/1.json`, JSON.stringify({ sessionId: 'me', cwd: '/repo', kind: 'interactive', entrypoint: 'cli', status: 'busy', name: 'repo-1' })],
  ])
  let mtime = 1
  let tails = 0
  on('ui.open', async () => ({ value: { isPlaced: true } }) as any)
  on('session.root', async () => ({ value: '/repo' }))
  on('session.id', async () => ({ value: 'me' }) as any)
  on('session.start', async (_$, e) => e as any)
  on('store.get', async () => ({ value: undefined }) as any)
  on('command.register', async () => ({ value: undefined }) as any)
  on('tool.register', async () => ({ value: undefined }) as any)
  on('fs.read', async (_$, e) => {
    if (!files.has(e.path)) throw new Error('missing')
    return { value: files.get(e.path)! } as any
  })
  on('fs.list', async (_$, e) => ({
    value: [...files.keys()].filter(p => p.startsWith(`${e.path}/`)).map(p => ({ name: p.slice(e.path.length + 1), kind: 'file', size: 1, mtimeMs: 0, isLink: false })),
  }) as any)
  on('fs.stat', async () => ({ value: { kind: 'file', size: 10, mtimeMs: mtime, isLink: false } }) as any)
  on('process.run', async (_$, e) => (e.argv[0] === 'tail' && tails++, { value: { exitCode: 0, stdout: '', stderr: '' } }) as any)

  await $.session.start({ source: 'startup', cwd: '/repo', isInteractive: true } as any)
  await clock.advance(20_000)
  expect(tails).toBe(1)
  mtime = 2
  await clock.advance(5_000)
  expect(tails).toBe(2)
})

test('a session with no session-peers note still focuses its tab, found through herdr', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/h' })
  const reg = '/h/.claude/sessions'
  const files = new Map<string, string>([
    [`${reg}/1.json`, JSON.stringify({ sessionId: 'me', cwd: '/repo', kind: 'interactive', entrypoint: 'cli', status: 'busy', name: 'repo-1' })],
    [`${reg}/2.json`, JSON.stringify({ sessionId: 'b', cwd: '/repo', kind: 'interactive', entrypoint: 'cli', status: 'waiting', name: 'repo-2' })],
  ])
  const panes = { result: { panes: [{ tab_id: 'w3M:t1', agent_session: { value: 'b' } }, { tab_id: 'w3E:t1' }, { tab_id: 'w3X:t1', agent_session: { value: 'me' } }] } }
  const ran: string[][] = []
  on('ui.open', async () => ({ value: { isPlaced: true } }) as any)
  on('session.root', async () => ({ value: '/repo' }))
  on('session.id', async () => ({ value: 'me' }) as any)
  on('session.start', async (_$, e) => e as any)
  on('store.get', async () => ({ value: undefined }) as any)
  on('command.register', async () => ({ value: undefined }) as any)
  on('tool.register', async () => ({ value: undefined }) as any)
  on('fs.read', async (_$, e) => {
    if (!files.has(e.path)) throw new Error('missing')
    return { value: files.get(e.path)! } as any
  })
  on('fs.list', async (_$, e) => ({
    value: [...files.keys()].filter(p => p.startsWith(`${e.path}/`)).map(p => ({ name: p.slice(e.path.length + 1), kind: 'file', size: 1, mtimeMs: 0, isLink: false })),
  }) as any)
  on('process.run', async (_$, e) => {
    ran.push([...e.argv])
    const stdout = e.argv[1] === 'pane' ? JSON.stringify(panes) : ''
    return { value: { exitCode: 0, stdout, stderr: '' } } as any
  })

  await $.session.start({ source: 'startup', cwd: '/repo', isInteractive: true } as any)
  const ui = await $.ui.mount({ plugin: 'terminal-desk', surface: 'terminal', component: 'Pane', requestId: 'desk', props: { bodyColumns: 80, maxRows: 60 } } as any)
  // this session's own row is not a button
  await ui.press({ key: 'peer-me' }).catch(() => {})
  await ui.press({ key: 'peer-b' })
  expect(ran.filter(argv => argv[1] === 'tab')).toEqual([['herdr', 'tab', 'focus', 'w3M:t1']])
})

test('outside herdr, a named herdr session is found through session list and its tab focused with --session', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/h' }) // no HERDR_SOCKET_PATH: this session runs in another terminal
  const reg = '/h/.claude/sessions'
  const files = new Map<string, string>([
    [`${reg}/1.json`, JSON.stringify({ sessionId: 'me', cwd: '/repo', kind: 'interactive', entrypoint: 'cli', status: 'busy', name: 'repo-1' })],
    [`${reg}/2.json`, JSON.stringify({ sessionId: 'b', cwd: '/repo', kind: 'interactive', entrypoint: 'cli', status: 'idle', name: 'repo-2' })],
  ])
  const sessions = { sessions: [{ default: true, name: 'default', running: false }, { default: false, name: 'work', running: true }, { default: false, name: 'posters', running: false }] }
  const panes = { result: { panes: [{ tab_id: 'w4T:t1', agent_session: { value: 'b' } }] } }
  const ran: string[][] = []
  on('ui.open', async () => ({ value: { isPlaced: true } }) as any)
  on('session.root', async () => ({ value: '/repo' }))
  on('session.id', async () => ({ value: 'me' }) as any)
  on('session.start', async (_$, e) => e as any)
  on('store.get', async () => ({ value: undefined }) as any)
  on('command.register', async () => ({ value: undefined }) as any)
  on('tool.register', async () => ({ value: undefined }) as any)
  on('fs.read', async (_$, e) => {
    if (!files.has(e.path)) throw new Error('missing')
    return { value: files.get(e.path)! } as any
  })
  on('fs.list', async (_$, e) => ({
    value: [...files.keys()].filter(p => p.startsWith(`${e.path}/`)).map(p => ({ name: p.slice(e.path.length + 1), kind: 'file', size: 1, mtimeMs: 0, isLink: false })),
  }) as any)
  on('process.run', async (_$, e) => {
    ran.push([...e.argv])
    const argv = e.argv.join(' ')
    const stdout = argv === 'herdr session list --json' ? JSON.stringify(sessions) : argv === 'herdr --session work pane list' ? JSON.stringify(panes) : ''
    return { value: { exitCode: 0, stdout, stderr: '' } } as any
  })

  await $.session.start({ source: 'startup', cwd: '/repo', isInteractive: true } as any)
  const ui = await $.ui.mount({ plugin: 'terminal-desk', surface: 'terminal', component: 'Pane', requestId: 'desk', props: { bodyColumns: 80, maxRows: 60 } } as any)
  await ui.press({ key: 'peer-b' })
  // only the running session is asked, and the click goes to the socket that listed the tab
  expect(ran.filter(argv => argv.includes('pane'))).toEqual([['herdr', '--session', 'work', 'pane', 'list']])
  expect(ran.filter(argv => argv.includes('focus'))).toEqual([['herdr', '--session', 'work', 'tab', 'focus', 'w4T:t1']])
})
