#!/usr/bin/env bash
# PostToolUse(Bash) after `gh pr merge`, or run by hand from a repo: remove finished git
# worktrees and their local branches. Finished = branch merged into the default branch,
# no uncommitted or untracked files, no unpushed commits, no stash on that branch.
# Acts only on worktrees under a root listed in the plugin option worktree_sweep_roots
# (one per line, or ":"-separated); with no roots it does nothing. The main checkout and
# the worktree you are standing in are never touched.
# Dry-run is the default: it logs "would remove" and changes nothing until
# worktree_sweep_dry_run is switched off. Every action goes to ${CLAUDE_PLUGIN_DATA}/worktree-sweep.log.
set -u

ROOTS=$(printf '%s' "${CLAUDE_PLUGIN_OPTION_WORKTREE_SWEEP_ROOTS:-}" | tr ':' '\n' | sed 's:/*$::' | grep '^/' | while IFS= read -r r; do (cd "$r" 2>/dev/null && pwd -P) || echo "$r"; done)
[ -z "$ROOTS" ] && exit 0
LOGDIR=${CLAUDE_PLUGIN_DATA:-}
[ -z "$LOGDIR" ] && { echo "worktree-sweep: CLAUDE_PLUGIN_DATA not set, no log possible, doing nothing"; exit 0; }
mkdir -p "$LOGDIR"; LOG="$LOGDIR/worktree-sweep.log"
case "$(printf '%s' "${CLAUDE_PLUGIN_OPTION_WORKTREE_SWEEP_DRY_RUN:-true}" | tr 'A-Z' 'a-z')" in
  false|0|no|off) DRY=0 ;; *) DRY=1 ;;
esac
say() { echo "worktree-sweep: $*"; echo "$(date '+%F %T') $*" >> "$LOG"; }

cwd=$PWD
if [ ! -t 0 ]; then
  cwd=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("cwd",""))' 2>/dev/null)
  [ -z "$cwd" ] && cwd=$PWD
fi
common=$(git -C "$cwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0
REPO=$(cd "$common/.." && pwd -P)
cd "$REPO" || exit 0
git remote | grep -qx origin && git fetch -q --prune origin 2>/dev/null

BASE=$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null)
if [ -z "$BASE" ]; then
  for b in origin/main origin/master main master; do git rev-parse --verify -q "$b" >/dev/null && { BASE=$b; break; }; done
fi
[ -z "$BASE" ] && exit 0

in_roots() { local p=$1 r; while IFS= read -r r; do case "$p" in "$r"/*) return 0 ;; esac; done <<<"$ROOTS"; return 1; }

# Files that differ from BASE among those the branch changed: 0 = its work is in BASE, even after a squash merge.
unique() {
  local base files
  base=$(git merge-base "$BASE" "$1" 2>/dev/null) || { echo "?"; return; }
  files=$(git diff --name-only "$base" "$1")
  [ -z "$files" ] && { echo 0; return; }
  echo "$files" | tr '\n' '\0' | xargs -0 git diff --name-only "$BASE" "$1" -- | wc -l | tr -d ' '
}

git worktree list --porcelain | awk '/^worktree /{p=substr($0,10)} /^branch /{b=substr($0,19)} /^detached/{b=""} /^$/{print p"|"b; b=""}' |
while IFS='|' read -r path branch; do
  [ "$path" = "$REPO" ] && continue
  in_roots "$path" || continue
  case "$(cd "$cwd" 2>/dev/null && pwd -P)/" in "$path"/*) say "kept $path: you are inside it"; continue ;; esac
  if [ ! -d "$path" ]; then
    if [ $DRY = 1 ]; then say "would prune $path (directory gone)"; else git worktree prune; say "pruned $path (directory gone)"; fi
    continue
  fi
  keep=""
  if [ -z "$branch" ]; then keep="detached HEAD"
  elif [ -n "$(git -C "$path" status --porcelain --ignored)" ]; then keep="uncommitted, untracked or ignored files"
  elif ! git merge-base --is-ancestor "$branch" "$BASE" && [ "$(unique "$branch")" != 0 ]; then keep="work not in $BASE"
  elif git -C "$path" rev-parse --verify -q '@{u}' >/dev/null && [ "$(git -C "$path" rev-list --count '@{u}..HEAD')" != 0 ]; then keep="unpushed commits"
  elif git stash list --format='%gs' | grep -qE "^(WIP on|On) $branch[: ]"; then keep="stash on this branch"
  fi
  if [ -n "$keep" ]; then say "kept $path ($branch): $keep"; continue; fi
  sha=$(git rev-parse --short "$branch")
  if [ $DRY = 1 ]; then say "would remove $path and branch $branch (at $sha)"; continue; fi
  if git worktree remove "$path" && git branch -D "$branch" >/dev/null; then
    say "removed $path and branch $branch (was $sha)"
  else
    say "could not remove $path ($branch)"
  fi
done
exit 0
