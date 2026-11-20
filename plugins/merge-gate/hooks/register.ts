import type { EngineInterface, Register } from 'claude-code'

// A word the shell would expand: only the shell knows what it becomes, so the gate does not guess.
const UNREADABLE = /[$`{}\\"']/
const MAX_ROUNDS = 3
// Options of git merge and gh pr merge that take a value as the next word.
const GIT_VALUE_FLAGS = new Set(['-m', '-s', '-X', '--strategy', '--message'])
const GH_VALUE_FLAGS = new Set(['-b', '--body', '-F', '--body-file', '-t', '--subject', '-A', '--author-email', '--match-head-commit', '-R', '--repo'])

type Part = { kind: 'git'; dir: string | null; ref: string } | { kind: 'gh'; dir: string | null; pr: string | undefined } | { kind: 'refuse'; why: string }
type Row = { time: string; repo: string; branch: string; head: string; round: number; scope: string; secrets: string; tests: string; ok: boolean }
type Verdict = { deny?: string; note?: string }

const DONT = ' Do not retry the merge with another command or work around the gate.'
const refusal = (why: string) => 'merge-gate refused this merge and did not run it: ' + why + DONT

// ---- Reading the command line -------------------------------------------------

function tokenize(text: string): string[] {
  const words: string[] = []
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) words.push(m[1] ?? m[2] ?? m[3] ?? '')

  return words
}

/** The folder a later `cd arg` moves to, given the folder so far (null = the session folder). */
function joinDir(dir: string | null, arg: string): string {
  return dir === null || arg === '~' || arg.startsWith('/') || arg.startsWith('~/') ? arg : dir + '/' + arg
}

function positional(args: string[], valueFlags: Set<string>): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i] ?? ''
    if (valueFlags.has(a)) i += 1
    else if (!a.startsWith('-')) out.push(a)
  }

  return out
}

// ponytail: a text check on the command line. env, sudo, bash -c and $( ) are not followed, as in strict-guard; add them if a merge slips through.
function parseMerges(command: string): Part[] {
  const parts: Part[] = []
  let dir: string | null = null // where an earlier cd moved to; null means the session folder
  let lost = false // a cd the gate cannot follow
  for (const raw of command.split(/&&|\|\||;|\||\n|(?<![>&])&(?![>&])/)) {
    // A redirect (2>&1, &>file, 2> file) is not an argument; nor is an ( or { around the part, a VAR=value or a keyword before the command
    const tokens = tokenize(raw.trim().replace(/^[({]+\s*/, '').replace(/\s*[)}]+$/, ''))
    const words = tokens.filter((w, i) => !/^\d*&?[<>]/.test(w) && !/^\d*&?(>>?|<)$/.test(tokens[i - 1] ?? ''))
    while (/^(\w+=.*|if|then|do|else|elif|while|until|!|time|command|exec)$/.test(words[0] ?? '')) words.shift()
    if (words[0] === 'cd') {
      const arg = words[1] ?? '~'
      lost ||= arg === '-' || UNREADABLE.test(arg)
      dir = joinDir(dir, arg)
      continue
    }

    let where = dir
    let badDir = false
    let rest: string[] | undefined
    if (words[0] === 'git') {
      // git's own options come before the subcommand; -C moves where it runs
      let i = 1
      while (i < words.length && (words[i] ?? '').startsWith('-')) {
        if (words[i] === '-C' && i + 1 < words.length) {
          badDir ||= UNREADABLE.test(words[i + 1] ?? '')
          where = joinDir(where, words[i + 1] ?? '')
          i += 2
        } else {
          i += words[i] === '-c' ? 2 : 1
        }
      }
      if (words[i] === 'merge') rest = words.slice(i + 1)
    } else if (words[0] === 'gh' && words[1] === 'pr' && words[2] === 'merge') {
      rest = words.slice(3)
    }
    if (rest === undefined) continue

    const isGit = words[0] === 'git'
    const names = positional(rest, isGit ? GIT_VALUE_FLAGS : GH_VALUE_FLAGS)
    // git merge --abort, --continue, --quit and a bare git merge name no branch: not gated
    if (isGit && names.length === 0) continue
    if (lost || badDir) parts.push({ kind: 'refuse', why: 'the gate cannot tell which folder this merge runs in.' })
    else if (names.some(n => UNREADABLE.test(n))) parts.push({ kind: 'refuse', why: 'the gate cannot read which branch this merge names.' })
    else if (names.length > 1) parts.push({ kind: 'refuse', why: 'merge-gate checks one branch per merge.' })
    else if (isGit) parts.push({ kind: 'git', dir: where, ref: names[0] ?? '' })
    else parts.push({ kind: 'gh', dir: where, pr: names[0] })
  }

  return parts
}

// ---- The gate -------------------------------------------------------------------

// Resolves a folder named on the command line against the session folder.
async function folder($: EngineInterface, dir: string | null): Promise<string> {
  const cwd = await $.session.cwd()
  if (dir === null) return cwd
  if (dir === '~' || dir.startsWith('~/')) return ((await $.env.get('HOME')) ?? '') + dir.slice(1)

  return dir.startsWith('/') ? dir : cwd + '/' + dir
}

// Runs git in dir and returns its trimmed output; any failure throws, which refuses the merge.
async function git($: EngineInterface, dir: string, args: string[]): Promise<string> {
  const run = await $.process.run(['git', '-C', dir, ...args])
  if (run.exitCode !== 0) throw new Error('git ' + args.slice(0, 2).join(' ') + ': ' + (run.stderr.trim() || 'exit ' + run.exitCode))

  return run.stdout.trim()
}

async function ledgerPath($: EngineInterface): Promise<string> {
  const dir = (await $.env.get('CLAUDE_PLUGIN_DATA')) || (await $.env.get('HOME') ?? '') + '/.claude'

  return dir + '/merge-gate-ledger.jsonl'
}

// A missing ledger is empty; a ledger that exists but cannot be read throws, so the gate refuses instead of forgetting the failed rounds.
async function ledgerText($: EngineInterface, path: string): Promise<string> {
  return (await $.fs.exists(path)) ? String(await $.fs.read(path)) : ''
}

async function readLedger($: EngineInterface): Promise<Row[]> {
  return (await ledgerText($, await ledgerPath($))).split('\n').flatMap(line => {
    try {
      return line === '' ? [] : [JSON.parse(line) as Row]
    } catch {
      return []
    }
  })
}

// ponytail: read-then-write append, there is no append call; the ledger is small. Two sessions merging in the same instant can lose a line.
async function addLedger($: EngineInterface, row: Row) {
  const path = await ledgerPath($)
  await $.fs.write(path, (await ledgerText($, path)) + JSON.stringify(row) + '\n')
}

const lastLines = (text: string, n: number) => text.trim().split('\n').slice(-n).join('\n')

/** Every changed file must equal a scope entry, or sit under an entry that ends in a slash. */
const outsideScope = (files: string[], scope: string) => {
  const entries = scope.split(/\s+/).filter(Boolean)

  return files.filter(f => !entries.some(s => (s.endsWith('/') ? f.startsWith(s) : f === s)))
}

// Runs testCommand in the branch's own worktree, or in a throwaway one made for the run. Returns the output tail on failure.
async function runTests($: EngineInterface, dir: string, name: string, ref: string, testCommand: string): Promise<string | undefined> {
  const list = (await git($, dir, ['worktree', 'list', '--porcelain'])).split('\n\n')
  const own = list.find(block => block.split('\n').includes('branch refs/heads/' + name))
  let where = own?.split('\n').find(l => l.startsWith('worktree '))?.slice('worktree '.length)
  const made = where === undefined
  if (made) {
    where = ((await $.env.get('TMPDIR')) || '/tmp').replace(/\/$/, '') + '/merge-gate-' + Date.now()
    await git($, dir, ['worktree', 'add', '--detach', where, ref])
  }
  try {
    // A timeout or a command that cannot start is a failed test, not a gate error
    const run = await $.process.run(['sh', '-c', testCommand], { cwd: where, timeoutMs: 600_000 }).catch(err => ({ exitCode: 1, stdout: '', stderr: String(err?.message ?? err) }))

    return run.exitCode === 0 ? undefined : lastLines(run.stdout + '\n' + run.stderr, 30)
  } finally {
    if (made) await $.process.run(['git', '-C', dir, 'worktree', 'remove', '--force', where!]).catch(() => undefined)
  }
}

async function gate($: EngineInterface, part: Exclude<Part, { kind: 'refuse' }>, testCommand: string): Promise<Verdict> {
  const dir = await folder($, part.dir)
  let ref: string
  let base: string
  if (part.kind === 'git') {
    ref = part.ref
    base = 'HEAD'
  } else {
    const view = await $.process.run(['gh', 'pr', 'view', ...(part.pr === undefined ? [] : [part.pr]), '--json', 'headRefName,baseRefName'], { cwd: dir })
    if (view.exitCode !== 0) return { deny: refusal('gh could not read the pull request (' + view.stderr.trim() + ').') }
    const pr = JSON.parse(view.stdout) as { headRefName: string; baseRefName: string }
    ref = pr.headRefName
    base = 'origin/' + pr.baseRefName
  }

  // 1. The scope the orchestrator declared for the branch
  const name = ref.replace(/^origin\//, '')
  const found = await $.process.run(['git', '-C', dir, 'config', '--get', 'branch.' + name + '.scope'])
  if (found.exitCode > 1) throw new Error('git config: ' + (found.stderr.trim() || 'exit ' + found.exitCode))
  const scope = found.stdout.trim()
  if (found.exitCode === 1 || scope === '') return { note: 'merge-gate: no scope declared for ' + name + ', not gated.' }

  // 2. The cap on failed rounds: each distinct head that failed is one round
  const repo = await git($, dir, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  const failed = (await readLedger($)).filter(r => r.repo === repo && r.branch === name && r.ok === false)
  const heads = [...new Set(failed.map(r => r.head))]
  if (heads.length >= MAX_ROUNDS) {
    const last = failed[failed.length - 1]!

    return {
      deny:
        'merge-gate refused this merge: ' + name + ' has failed the gate three times (heads ' + heads.map(h => h.slice(0, 7)).join(', ') + '). ' +
        'Stop working on it. Hand the branch to the orchestrator or the user with what each round changed and the last failure: ' +
        'scope ' + last.scope + ', secrets ' + last.secrets + ', tests ' + last.tests + '. Do not attempt a fourth fix.',
    }
  }
  const round = heads.length + 1

  // 3 to 6. The three checks, in order; the first failure skips the rest
  const row: Row = { time: new Date().toISOString(), repo, branch: name, head: await git($, dir, ['rev-parse', ref]), round, scope: 'skipped', secrets: 'skipped', tests: 'skipped', ok: false }
  let check = ''
  let detail = ''

  const files = (await git($, dir, ['diff', '--name-only', '--no-renames', '-z', base + '...' + ref])).split('\0').filter(Boolean)
  const outside = outsideScope(files, scope)
  row.scope = outside.length === 0 ? 'pass' : 'fail'
  if (outside.length > 0) {
    check = 'scope'
    detail = 'these files are outside the declared scope (' + scope + '): ' + outside.slice(0, 10).join(', ') + (outside.length > 10 ? ' and ' + (outside.length - 10) + ' more' : '') + '.'
  }

  if (check === '') {
    const leaks = await $.process
      .run(['gitleaks', 'git', '--no-banner', '--no-color', '--verbose', '--redact', '--exit-code', '1', '--log-opts=' + base + '..' + ref, dir], { cwd: dir, timeoutMs: 120_000 })
      .catch((err: unknown) => String((err as Error)?.message ?? err))
    row.secrets = typeof leaks === 'string' ? 'missing' : leaks.exitCode === 0 ? 'pass' : 'fail'
    if (typeof leaks === 'string') {
      check = 'secrets'
      detail = 'gitleaks is not installed or could not finish, so the branch was not scanned for secrets (' + leaks.slice(0, 120) + '). Install it with: brew install gitleaks.'
    } else if (leaks.exitCode !== 0) {
      check = 'secrets'
      detail = 'gitleaks flagged the branch:\n' + (leaks.stdout + '\n' + leaks.stderr).trim().split('\n').slice(0, 20).join('\n')
    }
  }

  if (check === '') {
    if (testCommand === '') {
      row.tests = 'not run'
    } else {
      const tail = await runTests($, dir, name, ref, testCommand)
      row.tests = tail === undefined ? 'pass' : 'fail'
      if (tail !== undefined) {
        check = 'tests'
        detail = 'the test command failed:\n' + tail
      }
    }
  }

  row.ok = check === ''
  await addLedger($, row)
  if (row.ok) {
    return { note: 'merge-gate: ' + name + ' passed (scope, secrets, tests: ' + (row.tests === 'pass' ? 'pass' : 'not run (no testCommand set)') + '), round ' + round + '.' }
  }

  return { deny: refusal(name + ' failed the ' + check + ' check: ' + detail + '\nRound ' + round + ' of ' + MAX_ROUNDS + '.' + (round === MAX_ROUNDS ? ' The next attempt will be refused outright.' : '')) }
}

export const register: Register = (on, options) => {
  const testCommand = typeof options.testCommand === 'string' ? options.testCommand.trim() : ''

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const parts = parseMerges(String(e.command ?? ''))
    if (parts.length === 0) return next(e)

    const notes: string[] = []
    try {
      for (const part of parts) {
        const verdict = part.kind === 'refuse' ? { deny: refusal(part.why) } : await gate($, part, testCommand)
        if (verdict.deny !== undefined) return { deny: verdict.deny }
        if (verdict.note !== undefined) notes.push(verdict.note)
      }
    } catch (error) {
      // Anything unexpected refuses the merge
      return { deny: 'merge-gate hit an error and did not run this merge (' + String((error as Error)?.message ?? error).slice(0, 120) + ').' + DONT }
    }

    const result = await next(e)
    if (notes.length > 0 && result.deny === undefined) result.context = [...(result.context ?? []), ...notes]

    return result
  })
}
