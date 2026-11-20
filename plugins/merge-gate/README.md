# merge-gate

Refuses a merge Claude runs when the branch touches files outside its declared scope, carries a secret, or fails its tests; stops after three failed rounds.

## What it does

When Claude runs `git merge <branch>` or `gh pr merge [<n>]` through the Bash tool, and the branch has a scope declared in git config (`branch.<name>.scope`), the mod checks three things in order. Every file the branch changes against the base must sit inside the scope. gitleaks must find no secret in the branch's commits. The test command, if you set one, must pass in the branch's worktree. The first failure refuses the merge and says why. Each gated attempt adds one line to a ledger.

After three failed rounds on one branch (three different heads), the next merge is refused without running the checks. The message tells Claude to stop and hand the branch to the orchestrator or to you.

A branch with no declared scope runs untouched, with a note on the result: `merge-gate: no scope declared for <branch>, not gated.` This covers `git merge origin/main` syncs and hand-made branches. `git merge --abort`, `--continue` and `--quit` are never gated. A merge naming two branches, or a branch name made of a variable or a command substitution, is refused because the gate cannot tell what it would merge.

Limits, plainly. The tests run on the branch as it is, not on the merged result. Only merges that Claude runs through Bash are seen; a merge you run in your own terminal is not. It does not gate `git push`, and `git pull` merges too and is not gated. It is a text check on the command line, not a sandbox: a merge hidden inside `bash -c`, `$( )`, a script or another tool can get past it. With no test command set, the result says `tests: not run`, never "passed".

## What it needs

Claude Code with plugin mods support, `git` and `gitleaks` (`brew install gitleaks`, 8.19 or newer for `gitleaks git`). When gitleaks is missing, a gated merge is refused and the refusal says so. `gh` is needed only for `gh pr merge`. One option, `testCommand`, left empty by default.

## Hook events it uses

`tool.call` on Bash.

## What it deletes or stops

It deletes nothing of yours. It can stop one merge command: the Bash call is refused and never runs. To run the tests for a branch that has no worktree of its own, it adds a temporary detached worktree under `$TMPDIR` and removes it again. It writes one ledger file in the plugin's data folder (see below).

## What it sends off the machine

Nothing of its own. No model calls. `git` and `gitleaks` run locally. For `gh pr merge` it runs `gh pr view`, which asks GitHub for the pull request's branch names, as gh does. Your test command runs as you and does whatever it does.

## Install

```
claude plugin marketplace add varunmoka28/moka-harness
claude plugin install merge-gate@moka-harness
```

## Set a scope

The orchestrator runs this when it creates the worktree:

```
git -C <repo> config branch.<branch>.scope "plugins/a/ docs/notes.md"
```

Entries are separated by spaces and relative to the repo root. An entry ending in `/` is a folder prefix; any other entry is exactly one file. Git config is shared by every worktree of a repo, so the session that merges reads the scope the orchestrator set, and the worker never commits it.

The test command is the plugin option `testCommand`, for example `npm test`. It runs through `sh -c` in the branch's worktree. A branch with no worktree of its own is tested in a temporary detached checkout, so the command must work from a fresh checkout (no `node_modules`).

## Clear a branch's ledger lines

The ledger is `merge-gate-ledger.jsonl` in the plugin's data folder (`$CLAUDE_PLUGIN_DATA`, or `~/.claude` when that is unset). It holds one JSON line per gated attempt: time, repo, branch, head, round, the three check results and ok. A failed head counts once however many times it is retried. There is no command to reset a branch. Delete its lines by hand, for example:

```
grep -v '"branch":"t1"' merge-gate-ledger.jsonl > ledger.tmp && mv ledger.tmp merge-gate-ledger.jsonl
```

## License

MIT.
