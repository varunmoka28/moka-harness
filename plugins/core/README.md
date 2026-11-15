# core

The working style for Claude Code, three guard hooks, and a `doctor` skill.

## What it does

- Prints `working-style.md` into each session when it starts.
- `delete_guard`: before a Bash command runs, blocks deletes (`rm`, `find -delete`, `git clean`, `rmtree` and similar, also inside `bash -c`) that touch a protected path.
- `worktree_sweep`: after `gh pr merge`, removes git worktrees and their local branches that are merged, clean and fully pushed.
- `stale_agent_reaper`: when a session starts, stops processes that match a command-line text and have been running longer than a set age.
- `/core:doctor`: reports which outside tools and keys the groups you installed still need, with a one-line way to get each. It only reads; it installs nothing.

All three guards start in dry-run and do nothing until you give them a scope (see the plugin options in `plugin.json`).

## What it needs

Claude Code, `python3` (delete guard), `bash`, `git` and `jq` (the sweep and `doctor`). `ps` for the reaper.

## Hook events it uses

- `SessionStart`: prints the working style; on `startup` also runs the reaper.
- `PreToolUse` on `Bash`: the delete guard.
- `PostToolUse` on `Bash`, only for `gh pr merge *`: the worktree sweep.

## What it deletes or stops

- The delete guard only blocks; it never deletes. Its scope is the `protected_paths` option, and with it empty the guard does nothing.
- The sweep removes merged, clean worktrees and their branches, only under the folders in `worktree_sweep_roots`. Empty means nothing.
- The reaper stops processes whose command line contains a `reaper_match` text and that started more than `reaper_max_age_hours` ago. Empty match means nothing. It never stops the session's own process or its parents.
- Each one logs what it did, or would do, under `${CLAUDE_PLUGIN_DATA}` (`delete-guard.log`, `worktree-sweep.log`, `stale-agent-reaper.log`). Dry-run is on by default for all three.

## What it sends off the machine

Nothing. No hook or script opens a network connection.
