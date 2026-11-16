#!/usr/bin/env bash
# Read-only git/GitHub health report for the repo in the current directory.
# Deletes nothing. Needs: git, gh (authenticated), jq, gh-poi extension.
set -uo pipefail

git rev-parse --git-dir >/dev/null 2>&1 || { echo "not a git repo" >&2; exit 1; }
git fetch -q --prune origin || echo "WARN: fetch failed, remote data may be stale"

main=$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
main=${main:-main}
prs=$(mktemp); trap 'rm -f "$prs"' EXIT
gh pr list --state all --limit 1000 --json number,headRefName,state > "$prs"

# Newest PR for a branch: "#123 MERGED", or "no PR"
pr_for() { jq -r --arg b "$1" '[.[]|select(.headRefName==$b)]|max_by(.number)|if . then "#\(.number) \(.state)" else "no PR" end' "$prs"; }
# Of the files a branch changed since it forked, how many still differ from main.
# 0 = its work is in main, even after a squash merge. Can over-count if main later edited those files.
unique() {
  local base files
  base=$(git merge-base "origin/$main" "$1" 2>/dev/null) || { echo "?"; return; }
  files=$(git diff --name-only "$base" "$1")
  [ -z "$files" ] && { echo 0; return; }
  echo "$files" | tr '\n' '\0' | xargs -0 git diff --name-only "origin/$main" "$1" -- | wc -l | tr -d ' '
}

echo "## Checkout"
echo "repo:    $(git rev-parse --show-toplevel)"
echo "branch:  $(git branch --show-current) ($(pr_for "$(git branch --show-current)"))"
echo "dirty:   $(git status --porcelain | wc -l | tr -d ' ') files"
echo "$main:    $(git rev-list --count "$main..origin/$main") behind origin/$main, $(git rev-list --count "origin/$main..$main") ahead"

echo; echo "## Open PRs"
gh pr list --state open --json number,title,headRefName,createdAt,isDraft,mergeable \
  --jq '.[]|"#\(.number) | \(.headRefName) | opened \(.createdAt[:10]) | draft=\(.isDraft) | \(.mergeable) | \(.title[:70])"'
for b in $(gh pr list --state open --json headRefName --jq '.[].headRefName'); do
  echo "  $b: $(git rev-list --count "origin/$b..origin/$main" 2>/dev/null || echo '?') behind $main"
done

echo; echo "## Local branches safe to delete (gh poi --dry-run)"
gh poi --dry-run 2>&1 | sed -n '/^Deleted branches/,/^Branches not deleted/p' | sed '$d'

echo; echo "## Local branches (branch | PR | files differing from $main | upstream | last commit)"
git for-each-ref refs/heads --format='%(refname:short)|%(upstream:short)%(upstream:track)|%(committerdate:short)' |
while IFS='|' read -r b up date; do
  [ "$b" = "$main" ] && continue
  echo "$b | $(pr_for "$b") | $(unique "$b") | ${up:-never pushed} | $date"
done

echo; echo "## Remote branches (branch | PR | files differing from $main | last commit)"
git for-each-ref refs/remotes/origin --format='%(refname:short)|%(committerdate:short)' |
while IFS='|' read -r r date; do
  b=${r#origin/}
  case "$b" in HEAD|origin|"$main") continue;; esac
  echo "$b | $(pr_for "$b") | $(unique "$r") | $date"
done

echo; echo "## Worktrees (path | branch | dirty files | size)"
git worktree list --porcelain | awk '/^worktree /{p=substr($0,10)} /^branch /{b=substr($0,19)} /^detached/{b="(detached)"} /^$/{print p"|"b; b=""}' |
while IFS='|' read -r p b; do
  [ "$p" = "$(git rev-parse --show-toplevel)" ] && continue
  if [ -d "$p" ]; then
    d=$(git -C "$p" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    s=$(du -sh "$p" 2>/dev/null | cut -f1)
  else d="-"; s="MISSING (git worktree prune)"; fi
  echo "$p | $b $( [ "$b" != "(detached)" ] && pr_for "$b") | $d | $s"
done

echo; echo "## Stashes"
if [ -n "$(git stash list)" ]; then git stash list --format='%gd | %cr | %gs' | head -20; else echo "none"; fi
