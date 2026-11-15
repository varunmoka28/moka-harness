#!/usr/bin/env bash
# Usage: pin_changelog_check.sh <base-ref> <head-ref>
# Fails if a sha in .claude-plugin/marketplace.json changed between the refs and
# CHANGELOG.md gained no line naming that entry.
set -u
[ $# -eq 2 ] || { echo "usage: $0 <base-ref> <head-ref>" >&2; exit 2; }
base="$1"; head="$2"
M=.claude-plugin/marketplace.json

shas() {  # <ref>: prints "name<TAB>sha" per third-party entry
  git show "$1:$M" 2>/dev/null | python3 -c '
import json, sys
try: d = json.load(sys.stdin)
except ValueError: sys.exit(0)
for p in d.get("plugins", []):
    s = p.get("source")
    if isinstance(s, dict): print(p["name"] + "\t" + str(s.get("sha", "")))
'
}

old="$(shas "$base")"; new="$(shas "$head")"
[ -n "$new" ] || [ -z "$old" ] || { echo "cannot read $M at $head" >&2; exit 2; }
added="$(git diff "$base" "$head" -- CHANGELOG.md | grep '^+' | grep -v '^+++')"

rc=0
while IFS=$'\t' read -r name sha; do
  [ -n "$name" ] || continue
  was="$(printf '%s\n' "$old" | awk -F'\t' -v n="$name" '$1==n{print $2}')"
  [ -n "$was" ] && [ "$was" != "$sha" ] || continue
  printf '%s\n' "$added" | grep -Fqw -- "$name" \
    || { echo "pin changed for '$name' ($was -> $sha) with no CHANGELOG.md line naming it"; rc=1; }
done <<< "$new"
exit $rc
