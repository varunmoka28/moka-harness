# repo-health

A skill that reports on a git repo and its GitHub remote, then sorts what it finds into safe to delete, needs a look, and keep.

## What it does

Run it from inside a repo. It lists open PRs, local and remote branches (merged, unpushed, stale), worktrees with their disk size, and stashes.

## What it needs

`git`, `jq`, and `gh` signed in. The script also uses the `gh-poi` extension.

## Hook events it uses

None. It is a skill and one script.

## What it deletes or stops

Nothing. The report is read-only and it asks before any cleanup.

## What it sends off the machine

Requests to GitHub through `gh` (the PR list). Nothing else.
