---
name: repo-health
description: Read-only health check of a git repo and its GitHub remote. Reports open PRs, local and remote branches (merged, unpushed, stale), worktrees with their disk size, and stashes, then sorts them into safe to delete, needs a look, and keep. Use when the user asks about open PRs, how many branches exist, stale or merged branches, branch cleanup, worktree clutter, or a GitHub/repo health check. Deletes nothing without approval.
---

# Repo health

## 1. Run the report

From the repo root. When the user asks how many worktrees exist across a whole workspace folder, the script covers only one repo, so run it or `git worktree list` per repo: find repos with `find <workspace> -maxdepth 4 -name .git -type d -not -path '*/node_modules/*'`, then drop nested `.claude` and `.brv` git dirs that duplicate a parent checkout, and list each repo's `git worktree list`. Report the linked worktrees (the main checkout is not an extra), and for "how much space" run `du -sh` on each linked worktree path.

```bash
bash ~/.claude/skills/repo-health/repo-health.sh
```

Needs `gh` authenticated, `jq`, and the `gh-poi` extension (`gh extension install seachicken/gh-poi`).

The script is read-only apart from `git fetch --prune`.

## 2. Read the columns correctly

- **files differing from main**: of the files the branch changed since it forked, how many
  still differ from main. 0 means its work is in main, including after a squash merge
  (`git cherry` and `git branch --merged` both miss squash merges). It over-counts when main
  edited those files later, so a MERGED PR with a small non-zero count is usually fine, while
  a MERGED PR with a large count means work was added after the merge; inspect before deleting.
  `?` means no shared history with main (e.g. an old `master`).
- **PR** is the newest PR for that branch name. `no PR` plus unique commits means work
  that exists nowhere else.
- `[gone]` in upstream means GitHub deleted the remote after merge.

## 3. Classify

| Bucket | Rule |
|---|---|
| Safe to delete | listed by gh poi, or PR MERGED/CLOSED with 0 commits not in main |
| Needs a look | unique commits and no open PR; never pushed; dirty worktree; PR open but far behind main; old stashes |
| Keep | open PR, checked out in a clean active worktree, `main` |

Present the three lists as tables, plus any headline problems (checkout sitting on a
merged branch, main behind origin, missing worktree directories).

## 4. Cleanup only on approval

Never delete in the same turn as the report unless the user already said to. Before
deleting, write `name sha` for every branch to a file in the scratchpad so any of them can
be restored with `git branch <name> <sha>`.

- Local merged branches: `gh poi` (it skips worktrees and the current branch).
- Local squash-merged with 0 unique: `git branch -D <name>`.
- Remote: `git push origin --delete <name>`. This is visible to others; confirm the list first.
- Worktrees: `git worktree remove <path>` only when clean and its branch has 0 unique
  commits. Check with ListAgents or ask first, because a peer session may be working in it.
- Stashes: show `git stash show -p stash@{n}` before any drop. Never drop without approval.
