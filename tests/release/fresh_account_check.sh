#!/usr/bin/env bash
# Usage: bash tests/release/fresh_account_check.sh snapshot [file]   (new account, before installing)
#        bash tests/release/fresh_account_check.sh diff [file]       (after install and marketplace remove)
# Hashes every file under the Claude config folder (CLAUDE_CONFIG_DIR, else ~/.claude) and
# .claude.json. diff prints each added, removed or changed path not on the expected-leftover
# list (spec 10.3) and exits 1 if there is any. Read-only apart from the snapshot file.
set -euo pipefail

cfg="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
json="$HOME/.claude.json"; [ -n "${CLAUDE_CONFIG_DIR:-}" ] && json="$cfg/.claude.json"
mode="${1:-}"; snap="${2:-${TMPDIR:-/tmp}/moka-fresh-account.snapshot}"

# "<path relative to the config folder><TAB><sha256>", sorted. .claude.json is always ".claude.json".
hashes() {
  {
    [ -d "$cfg" ] && (cd "$cfg" && find . -type f ! -name .claude.json -print0 \
      | xargs -0 shasum -a 256 2>/dev/null | awk '{h=$1; sub(/^[^ ]+  \.\//,""); print $0 "\t" h}')
    [ -f "$json" ] && printf '.claude.json\t%s\n' "$(shasum -a 256 < "$json" | cut -d' ' -f1)"
    true
  } | LC_ALL=C sort
}

# Expected leftovers after `marketplace remove` (spec 10.3), as paths relative to the config folder.
expected='^(\.claude\.json|settings\.json|plugins/installed_plugins\.json|plugins/known_marketplaces\.json|plugins/\.last_inuse_sweep|backups/\.claude\.json\.backup\..*|plugins/cache/.*)$'

case "$mode" in
  snapshot) hashes > "$snap"; echo "snapshot: $(wc -l < "$snap" | tr -d ' ') files -> $snap" ;;
  diff)
    [ -f "$snap" ] || { echo "no snapshot at $snap" >&2; exit 2; }
    # Paths whose line differs between the snapshot and now, tagged by what happened.
    unexpected="$(diff <(cat "$snap") <(hashes) | awk -F'\t' '/^[<>]/ {print substr($1,3)}' \
      | LC_ALL=C sort -u | grep -Ev "$expected" || true)"
    if [ -n "$unexpected" ]; then echo "unexpected added, removed or changed:"; echo "$unexpected"; exit 1; fi
    echo "clean: nothing unexpected left behind" ;;
  *) echo "usage: $0 snapshot|diff [file]" >&2; exit 2 ;;
esac
