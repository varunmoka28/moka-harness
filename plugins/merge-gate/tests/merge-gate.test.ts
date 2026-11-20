import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

const LEDGER = '/data/merge-gate-ledger.jsonl'
const HEAD = 'a'.repeat(40)
const TESTS = { options: { testCommand: 'npm test' } }

type Row = { repo: string; branch: string; head: string; round: number; scope: string; secrets: string; tests: string; ok: boolean }
type World = {
  scope?: Record<string, string> // branch -> declared scope
  files?: string[] // what the branch changes against the base
  head?: string
  leaks?: 'clean' | 'found' | 'missing'
  testExit?: number
  testOut?: string
  worktrees?: Record<string, string> // branch -> its worktree folder
  pr?: { head: string; base: string } | { error: string }
  ledger?: Partial<Row>[]
  ledgerBroken?: boolean // the ledger exists but cannot be read
  gitFails?: boolean // git cannot start
  badRef?: boolean // git does not know the branch
}

const out = (exitCode: number, stdout = '', stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })

// Stands for the engine: git, gitleaks, gh and the test command by argv, one in-memory ledger file, and the merge itself.
const host = (on: On, w: World = {}) => {
  const seen = { runs: [] as { argv: string[]; cwd?: string }[], merged: [] as string[], head: w.head ?? HEAD }
  const files: Record<string, string> = {}
  if (w.ledger) files[LEDGER] = w.ledger.map(r => JSON.stringify({ repo: '/repo/.git', branch: 't1', ok: false, ...r }) + '\n').join('')
  mock.env(on, { HOME: '/home', CLAUDE_PLUGIN_DATA: '/data', TMPDIR: '/tmp/' })
  on('session.cwd', () => ({ value: '/repo' }))
  on('fs.exists', (_, e) => ({ value: files[e.path] !== undefined || (w.ledgerBroken === true && e.path === LEDGER) }))
  on('fs.read', (_, e) => {
    if (w.ledgerBroken || files[e.path] === undefined) throw new Error(w.ledgerBroken ? 'EIO: read failed' : 'ENOENT')

    return { value: files[e.path]! }
  })
  on('fs.write', (_, e) => {
    files[e.path] = e.text

    return { value: undefined }
  })
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    seen.runs.push({ argv, cwd: e.init?.cwd })
    if (argv[0] === 'gitleaks') {
      if (w.leaks === 'missing') throw new Error('spawn gitleaks ENOENT')

      return w.leaks === 'found' ? out(1, 'Finding: key=REDACTED\nFile: b.env') : out(0)
    }
    if (argv[0] === 'sh') return out(w.testExit ?? 0, w.testOut ?? 'tests ok')
    if (argv[0] === 'gh') return w.pr === undefined || 'error' in w.pr ? out(1, '', w.pr?.error ?? 'no pull requests found') : out(0, JSON.stringify({ headRefName: w.pr.head, baseRefName: w.pr.base }))
    // git -C <dir> <sub> ...
    const sub = argv.slice(3)
    if (w.gitFails && sub[0] === 'config') throw new Error('spawn git EACCES')
    if (sub[0] === 'config') {
      const scope = w.scope?.[sub[2]!.replace(/^branch\./, '').replace(/\.scope$/, '')]

      return scope === undefined ? out(1) : out(0, scope + '\n')
    }
    if (sub[0] === 'rev-parse' && sub[1] === '--path-format=absolute') return out(0, '/repo/.git\n')
    if (sub[0] === 'rev-parse') return w.badRef ? out(128, 't1\n', 'fatal: ambiguous argument: unknown revision') : out(0, seen.head + '\n')
    if (sub[0] === 'diff') return out(0, (w.files ?? []).join('\0'))
    if (sub[0] === 'worktree' && sub[1] === 'list') {
      const own = Object.entries(w.worktrees ?? {}).map(([b, p]) => 'worktree ' + p + '\nHEAD ' + HEAD + '\nbranch refs/heads/' + b + '\n')

      return out(0, ['worktree /repo\nHEAD ' + HEAD + '\nbranch refs/heads/main\n', ...own].join('\n') + '\n')
    }

    return out(0)
  })
  on('tool.call', { tool: 'Bash' }, (_, e) => {
    seen.merged.push(e.command)

    return { result: { stdout: '', stderr: '', interrupted: false }, text: 'Merge made by the ort strategy.' }
  })

  return {
    ...seen,
    state: seen,
    ledger: () => (files[LEDGER] ?? '').split('\n').filter(Boolean).map(l => JSON.parse(l) as Row),
    ledgerText: () => files[LEDGER] ?? '',
    ran: (cmd: string) => seen.runs.some(r => r.argv.includes(cmd)),
  }
}

const merge = ($: Parameters<TestBody>[0], command: string) => $.tool.call({ tool: 'Bash', command })
// The notes the model reads after the tool result
const notes = (res: { context?: readonly string[] }) => (res.context ?? []).join('\n')

test('AC1: a file outside the scope is refused, named with the scope, and the round is written to the ledger', async ($, on) => {
  const h = host(on, { scope: { t1: 'plugins/a/' }, files: ['plugins/a/ok.ts', 'plugins/b/x.ts'] })
  const res = await merge($, 'git merge t1')
  expect(res.deny).toContain('plugins/b/x.ts')
  expect(res.deny).toContain('plugins/a/')
  expect(res.deny).toContain('Round 1 of 3')
  expect(h.merged).toEqual([])
  const rows = h.ledger()
  expect(rows).toHaveLength(1)
  expect([rows[0]!.scope, rows[0]!.secrets, rows[0]!.tests, rows[0]!.ok, rows[0]!.round, rows[0]!.branch]).toEqual(['fail', 'skipped', 'skipped', false, 1, 't1'])
  expect(h.ran('gitleaks')).toBe(false)
})

test('a scope entry that does not end in a slash is one exact file', async ($, on) => {
  host(on, { scope: { t1: 'src/a.ts docs/' }, files: ['src/a.ts', 'docs/x/y.md', 'src/a.tsx'] })
  const res = await merge($, 'git merge t1')
  expect(res.deny).toContain('src/a.tsx')
  expect(res.deny).not.toContain('src/a.ts,')
  expect(res.deny).not.toContain('docs/x/y.md')
})

test('AC2: a secret found refuses the merge and the tests are not run', TESTS, async ($, on) => {
  const h = host(on, { scope: { t1: 'a/' }, files: ['a/x'], leaks: 'found' })
  const res = await merge($, 'git merge t1')
  expect(res.deny).toContain('secrets check')
  expect(res.deny).toContain('Finding: key=REDACTED')
  expect(h.ran('sh')).toBe(false)
  const row = h.ledger()[0]!
  expect([row.scope, row.secrets, row.tests, row.ok]).toEqual(['pass', 'fail', 'skipped', false])
  const gl = h.state.runs.find(r => r.argv[0] === 'gitleaks')!.argv
  expect(gl).toEqual(['gitleaks', 'git', '--no-banner', '--no-color', '--verbose', '--redact', '--exit-code', '1', '--log-opts=HEAD..t1', '/repo'])
})

test('AC3: gitleaks that cannot start refuses the merge and says how to install it', async ($, on) => {
  const h = host(on, { scope: { t1: 'a/' }, files: ['a/x'], leaks: 'missing' })
  const res = await merge($, 'git merge t1')
  expect(res.deny).toContain('gitleaks is not installed')
  expect(res.deny).toContain('brew install gitleaks')
  expect(h.merged).toEqual([])
  expect([h.ledger()[0]!.secrets, h.ledger()[0]!.ok]).toEqual(['missing', false])
})

test('AC4: a failing test command refuses the merge with its output tail, run in the branch worktree', TESTS, async ($, on) => {
  const h = host(on, { scope: { t1: 'a/' }, files: ['a/x'], worktrees: { t1: '/wt/t1' }, testExit: 1, testOut: Array.from({ length: 40 }, (_, i) => 'line ' + (i + 1)).join('\n') })
  const res = await merge($, 'git merge t1')
  expect(res.deny).toContain('tests check')
  expect(res.deny).toContain('line 40')
  expect(res.deny).toContain('line 11')
  expect(res.deny).not.toContain('line 10\n')
  const sh = h.state.runs.find(r => r.argv[0] === 'sh')!
  expect(sh.argv).toEqual(['sh', '-c', 'npm test'])
  expect(sh.cwd).toBe('/wt/t1')
  expect([h.ledger()[0]!.tests, h.ledger()[0]!.ok]).toEqual(['fail', false])
})

test('a branch with no worktree is tested in a throwaway detached one, removed afterwards', TESTS, async ($, on) => {
  const h = host(on, { scope: { t1: 'a/' }, files: ['a/x'] })
  const res = await merge($, 'git merge t1')
  expect(res.deny).toBeUndefined()
  const add = h.state.runs.find(r => r.argv.includes('add'))!.argv
  const tmp = add[add.length - 2]!
  expect(add.slice(3, 5)).toEqual(['worktree', 'add'])
  expect(add).toContain('--detach')
  expect(tmp.startsWith('/tmp/merge-gate-')).toBe(true)
  expect(h.state.runs.find(r => r.argv[0] === 'sh')!.cwd).toBe(tmp)
  expect(h.state.runs.some(r => r.argv.slice(3, 6).join(' ') === 'worktree remove --force' && r.argv.includes(tmp))).toBe(true)
  expect(h.ledger()[0]!.tests).toBe('pass')
})

test('AC5: with no test command the merge runs and says tests were not run, never passed', async ($, on) => {
  const h = host(on, { scope: { t1: 'a/' }, files: ['a/x'] })
  const res = await merge($, 'git merge t1')
  expect(res.deny).toBeUndefined()
  expect(h.merged).toEqual(['git merge t1'])
  expect(res.text).toContain('Merge made by the ort strategy.')
  expect(notes(res)).toContain('tests: not run')
  expect(notes(res)).not.toContain('tests: pass')
  expect(h.ledgerText()).toContain('"tests":"not run","ok":true')
  expect(h.ran('sh')).toBe(false)
})

test('AC6: after three failed heads the merge is refused outright, no check runs, no line is added', TESTS, async ($, on) => {
  const h = host(on, { scope: { t1: 'a/' }, files: ['a/x'], ledger: [{ head: 'a1'.repeat(20) }, { head: 'b2'.repeat(20) }, { head: 'c3'.repeat(20), scope: 'fail', secrets: 'skipped', tests: 'skipped' }] })
  const before = h.ledgerText()
  const res = await merge($, 'git merge t1')
  expect(res.deny).toContain('failed the gate three times')
  expect(res.deny).toContain('a1a1a1a, b2b2b2b, c3c3c3c')
  expect(res.deny).toContain('scope fail, secrets skipped, tests skipped')
  expect(res.deny).toContain('Do not attempt a fourth fix')
  expect(h.merged).toEqual([])
  for (const cmd of ['diff', 'gitleaks', 'sh']) expect(h.ran(cmd)).toBe(false)
  expect(h.ledgerText()).toBe(before)
})

test('three failed rounds at three heads count up, then the fourth attempt is the stop message', async ($, on) => {
  const h = host(on, { scope: { t1: 'a/' }, files: ['b/x'] })
  const rounds: string[] = []
  for (const head of ['1'.repeat(40), '2'.repeat(40), '3'.repeat(40)]) {
    h.state.head = head
    rounds.push((await merge($, 'git merge t1')).deny ?? '')
  }
  expect(rounds[0]).toContain('Round 1 of 3')
  expect(rounds[1]).toContain('Round 2 of 3')
  expect(rounds[2]).toContain('Round 3 of 3')
  expect(rounds[2]).toContain('refused outright')
  expect(rounds[1]).not.toContain('refused outright')
  const fourth = await merge($, 'git merge t1')
  expect(fourth.deny).toContain('failed the gate three times')
  expect(h.ledger()).toHaveLength(3)
})

test('AC7: two failed lines at the same head count once', async ($, on) => {
  const h = host(on, { scope: { t1: 'a/' }, files: ['a/x'], ledger: [{ head: 'a1'.repeat(20) }, { head: 'a1'.repeat(20) }, { head: 'b2'.repeat(20) }] })
  const res = await merge($, 'git merge t1')
  expect(res.deny).toBeUndefined()
  expect(h.merged).toEqual(['git merge t1'])
  expect(h.ledger().slice(-1)[0]!.round).toBe(3)
})

test('a failed round on another branch or another repo does not count', async ($, on) => {
  const h = host(on, { scope: { t1: 'a/' }, files: ['a/x'], ledger: [{ head: '1'.repeat(40), branch: 't2' }, { head: '2'.repeat(40), repo: '/other/.git' }, { head: '3'.repeat(40), ok: true }] })
  expect((await merge($, 'git merge t1')).deny).toBeUndefined()
  expect(h.ledger().slice(-1)[0]!.round).toBe(1)
})

test('AC8: no declared scope, or a sync from origin/main, runs untouched with a note and no ledger line', async ($, on) => {
  const h = host(on, { files: ['anything'] })
  const res = await merge($, 'git merge t1')
  expect(res.deny).toBeUndefined()
  expect(notes(res)).toContain('merge-gate: no scope declared for t1, not gated.')
  const sync = await merge($, 'git merge origin/main')
  expect(notes(sync)).toContain('no scope declared for main, not gated.')
  expect(h.state.runs.some(r => r.argv.includes('branch.main.scope'))).toBe(true)
  expect(h.merged).toEqual(['git merge t1', 'git merge origin/main'])
  expect(h.ledgerText()).toBe('')
  for (const cmd of ['diff', 'gitleaks', 'sh']) expect(h.ran(cmd)).toBe(false)
})

test('AC9: commands that are not gated merges pass through untouched', async ($, on) => {
  const h = host(on, { scope: { t1: 'a/' }, files: ['b/x'] })
  for (const command of ['git merge --abort', 'git merge --continue', 'git merge --quit', 'git status', 'ls && git log --oneline', 'echo git merge t1']) {
    const res = await merge($, command)
    expect(res.deny).toBeUndefined()
    expect(res.text).toBe('Merge made by the ort strategy.')
    expect(res.context).toBeUndefined()
  }
  expect(h.state.runs).toEqual([])
})

test('AC9: cd dir && git merge and git -C dir merge are gated in that folder', async ($, on) => {
  const h = host(on, { scope: { t1: 'a/' }, files: ['b/x'] })
  for (const command of ['cd sub && git merge t1', 'git -C sub merge t1', 'cd /abs/repo; git merge t1', 'cd ~/work && git merge t1']) {
    h.state.runs.length = 0
    expect((await merge($, command)).deny).toContain('b/x')
    const dirs = new Set(h.state.runs.filter(r => r.argv[0] === 'git').map(r => r.argv[2]))
    expect([...dirs]).toEqual([{ 'cd sub && git merge t1': '/repo/sub', 'git -C sub merge t1': '/repo/sub', 'cd /abs/repo; git merge t1': '/abs/repo', 'cd ~/work && git merge t1': '/home/work' }[command]])
  }
})

test('AC9: a branch the gate cannot read, or two branches, are refused', async ($, on) => {
  const h = host(on, { scope: { t1: 'a/' }, files: ['a/x'] })
  for (const command of ['git merge "$B"', 'git merge ${B}', 'git merge $(git branch --show-current)', 'cd "$DIR" && git merge t1']) {
    expect((await merge($, command)).deny).toContain('cannot')
  }
  expect((await merge($, 'git merge a b')).deny).toContain('one branch per merge')
  expect((await merge($, 'cd - && git merge t1')).deny).toContain('cannot tell which folder')
  expect(h.merged).toEqual([])
  expect(h.state.runs).toEqual([])
})

test('a commit message, redirects and a pipe do not hide the branch', async ($, on) => {
  const h = host(on, { scope: { t1: 'a/' }, files: ['b/x'] })
  const res = await merge($, 'git merge --no-ff -m "Merge t1 into main" t1 2>&1 | tail -5')
  expect(res.deny).toContain('t1 failed the scope check')
  expect(h.merged).toEqual([])
})

test('a VAR=value prefix, a subshell and &> do not hide the merge', async ($, on) => {
  const h = host(on, { scope: { t1: 'a/' }, files: ['b/x'] })
  for (const command of ['GIT_EDITOR=true git merge t1', '(cd sub && git merge t1)', 'git merge t1 &>/dev/null']) {
    expect((await merge($, command)).deny).toContain('t1 failed the scope check')
  }
  expect(h.merged).toEqual([])
})

test('a redirect target, a background command, a keyword and a -C on another command do not hide or break a merge', async ($, on) => {
  const h = host(on, { scope: { t1: 'a/' }, files: ['b/x'] })
  for (const command of ['git merge t1 2> /dev/null', 'sleep 1 & git merge t1', 'if true; then git merge t1; fi', 'git merge t1 > out.log 2>&1']) {
    expect((await merge($, command)).deny).toContain('t1 failed the scope check')
  }
  // an unreadable -C belongs to the fetch, not to the merge after it
  const sync = await merge($, 'git -C "$REPO" fetch && git merge t1')
  expect(sync.deny).toContain('t1 failed the scope check')
  expect(h.merged).toEqual([])
})

test('a file renamed into the scope is checked at both paths', async ($, on) => {
  const h = host(on, { scope: { t1: 'a/' }, files: ['a/x.ts', 'b/x.ts'] })
  const res = await merge($, 'git merge t1')
  expect(res.deny).toContain('b/x.ts')
  expect(h.state.runs.find(r => r.argv.includes('diff'))!.argv).toContain('--no-renames')
})

test('a ledger that exists but cannot be read refuses the merge instead of starting a new one', async ($, on) => {
  const h = host(on, { scope: { t1: 'a/' }, files: ['a/x'], ledgerBroken: true })
  const res = await merge($, 'git merge t1')
  expect(res.deny).toContain('merge-gate hit an error')
  expect(h.merged).toEqual([])
  expect(h.ledgerText()).toBe('')
})

test('the second of two merges on one line is gated too', async ($, on) => {
  const h = host(on, { scope: { t1: 'a/', t2: 'c/' }, files: ['a/x'] })
  const res = await merge($, 'git merge t1 && git merge t2')
  expect(res.deny).toContain('t2 failed the scope check')
  expect(h.merged).toEqual([])
})

test('AC10: gh pr merge gates the pull request head against origin/<base>', async ($, on) => {
  const h = host(on, { scope: { t1: 'a/' }, files: ['a/x'], pr: { head: 't1', base: 'main' } })
  const res = await merge($, 'gh pr merge 7 --squash --delete-branch')
  expect(res.deny).toBeUndefined()
  expect(h.state.runs[0]!.argv).toEqual(['gh', 'pr', 'view', '7', '--json', 'headRefName,baseRefName'])
  expect(h.state.runs.find(r => r.argv.includes('diff'))!.argv.slice(-1)).toEqual(['origin/main...t1'])
  expect(h.state.runs.find(r => r.argv[0] === 'gitleaks')!.argv).toContain('--log-opts=origin/main..t1')
  expect(h.merged).toEqual(['gh pr merge 7 --squash --delete-branch'])
  expect(notes(res)).toContain('t1 passed')
})

test('AC10: gh pr merge with no number reads the current branch pull request; a failing gh view refuses with its stderr', async ($, on) => {
  const h = host(on, { pr: { error: 'no pull requests found for branch "t9"' } })
  const res = await merge($, 'gh pr merge')
  expect(h.state.runs[0]!.argv).toEqual(['gh', 'pr', 'view', '--json', 'headRefName,baseRefName'])
  expect(res.deny).toContain('no pull requests found for branch')
  expect(h.merged).toEqual([])
  expect(h.ledgerText()).toBe('')
})

test('AC11: an unexpected failure inside the gate refuses the merge', async ($, on) => {
  const h = host(on, { scope: { t1: 'a/' }, files: ['a/x'], gitFails: true })
  const res = await merge($, 'git merge t1')
  expect(res.deny).toContain('merge-gate hit an error')
  expect(h.merged).toEqual([])
})

test('AC11: a branch git does not know refuses the merge with git\'s own words', async ($, on) => {
  const h = host(on, { scope: { t1: 'a/' }, files: ['a/x'], badRef: true })
  const res = await merge($, 'git merge t1')
  expect(res.deny).toContain('merge-gate hit an error')
  expect(res.deny).toContain('unknown revision')
  expect(h.merged).toEqual([])
  expect(h.ledgerText()).toBe('')
})
