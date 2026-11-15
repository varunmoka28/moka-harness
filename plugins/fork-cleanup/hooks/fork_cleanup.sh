#!/usr/bin/env bash
# SessionStart: delete stale forks from the account the user named.
# A fork qualifies only if it belongs to that account, is at least min_age_days old,
# has no commits that are not in its parent, and is not on the keep list.
# Dry-run unless delete_forks is "true". Every decision is logged under CLAUDE_PLUGIN_DATA.
command -v gh >/dev/null || exit 0

ACCOUNT="${CLAUDE_PLUGIN_OPTION_GITHUB_ACCOUNT:-}"
[ -n "$ACCOUNT" ] || exit 0
[ -n "${CLAUDE_PLUGIN_DATA:-}" ] || exit 0

DELETE="${CLAUDE_PLUGIN_OPTION_DELETE_FORKS:-false}"
DAYS="${CLAUDE_PLUGIN_OPTION_MIN_AGE_DAYS:-90}"
case "$DAYS" in ''|*[!0-9]*|0|00) DAYS=90 ;; esac
KEEP=",$(printf '%s' "${CLAUDE_PLUGIN_OPTION_KEEP:-}" | tr -d ' ' | tr 'A-Z' 'a-z'),"

mkdir -p "$CLAUDE_PLUGIN_DATA" || exit 0
LOG="$CLAUDE_PLUGIN_DATA/fork-cleanup.log"
log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$LOG"; }
say() { log "$*"; echo "fork-cleanup: $*"; }

# Only the signed-in user's own account; never an organisation.
me=$(gh api user --jq .login 2>/dev/null)
[ "$(printf '%s' "$me" | tr 'A-Z' 'a-z')" = "$(printf '%s' "$ACCOUNT" | tr 'A-Z' 'a-z')" ] || { log "stop: gh is signed in as '${me:-nobody}', not $ACCOUNT"; exit 0; }

CUTOFF=$(( $(date +%s) - DAYS * 86400 ))

gh repo list "$ACCOUNT" --fork --limit 100 --json nameWithOwner,createdAt \
  --jq '.[] | [.nameWithOwner, (.createdAt | fromdateiso8601 | tostring)] | join("|")' 2>/dev/null |
while IFS='|' read -r fork created; do
  [ -n "$fork" ] || continue
  name="${fork#*/}"
  lower="$(printf '%s' "$fork" | tr 'A-Z' 'a-z')"
  lname="$(printf '%s' "$name" | tr 'A-Z' 'a-z')"
  case "$KEEP" in *",$lower,"*|*",$lname,"*) log "skip $fork: on keep list"; continue ;; esac
  [ "$created" -le "$CUTOFF" ] 2>/dev/null || { log "skip $fork: younger than $DAYS days"; continue; }

  info=$(gh api "repos/$fork" --jq '[.parent.full_name // "", .parent.default_branch // "", .default_branch // ""] | join("|")' 2>/dev/null) || { log "skip $fork: could not read repo"; continue; }
  IFS='|' read -r parent pbranch fbranch <<<"$info"
  [ -n "$parent" ] || { log "skip $fork: no parent"; continue; }
  nb=$(gh api "repos/$fork/branches" --jq length 2>/dev/null) || { log "skip $fork: could not read branches"; continue; }
  [ "$nb" = 1 ] || { log "skip $fork: has $nb branches"; continue; }
  ahead=$(gh api "repos/$parent/compare/$pbranch...$ACCOUNT:$fbranch" --jq .ahead_by 2>/dev/null) || { log "skip $fork: could not compare with parent"; continue; }
  [ "$ahead" = 0 ] || { log "skip $fork: $ahead commits not in $parent"; continue; }

  if [ "$DELETE" = true ]; then
    if gh repo delete "$fork" --yes >/dev/null 2>&1; then say "deleted $fork"; else say "FAILED to delete $fork"; fi
  else
    say "dry-run: would delete $fork"
  fi
done
exit 0
