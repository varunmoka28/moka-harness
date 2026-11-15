#!/usr/bin/env bash
# Reports which outside tools and keys the installed moka-harness groups still need.
# Read-only: installs nothing, changes nothing, never prints a key value.
# Exit 0 when every need of an installed group is met, 1 otherwise.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REC="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/installed_plugins.json"

command -v jq >/dev/null 2>&1 || { echo "missing  tool  jq  brew install jq (doctor needs it to read the install record)"; exit 1; }
installed=""
[ -r "$REC" ] && installed="$(jq -r '.plugins // {} | keys[]' "$REC" 2>/dev/null | sed -n 's/@moka-harness$//p')"
has() { printf '%s\n' "$installed" | grep -qx -- "$1"; }

groups=""
while IFS=$'\t' read -r g kind name how; do
  case "$g" in ''|'#'*) continue ;; esac
  case " $groups " in *" $g "*) continue ;; esac
  if has "$g"; then groups="$groups $g"; continue; fi
  [ "$kind" = plugin ] && has "$name" && groups="$groups $g"
done < "$HERE/needs.tsv"

[ -z "$groups" ] && { echo "No moka-harness groups installed. Nothing to check."; exit 0; }

rc=0
while IFS=$'\t' read -r g kind name how; do
  case "$g" in ''|'#'*) continue ;; esac
  case " $groups " in *" $g "*) ;; *) continue ;; esac
  case "$kind" in
    tool) command -v "$name" >/dev/null 2>&1 && ok=1 || ok=0 ;;
    env) [ -n "${!name:-}" ] && ok=1 || ok=0 ;;
    account)
      case "$name" in
        aws) { [ -n "${AWS_ACCESS_KEY_ID:-}" ] || [ -n "${AWS_PROFILE:-}" ] || [ -r "$HOME/.aws/credentials" ]; } && ok=1 || ok=0 ;;
        *) printf '%-12s unchecked  %s  %s\n' "$g" "$name" "$how"; continue ;;  # no way to test from a shell
      esac ;;
    *) continue ;;
  esac
  if [ "$ok" = 1 ]; then printf '%-12s ok         %s  %s\n' "$g" "$kind" "$name"
  else printf '%-12s missing    %s  %s  -> %s\n' "$g" "$kind" "$name" "$how"; rc=1; fi
done < "$HERE/needs.tsv"
exit $rc
