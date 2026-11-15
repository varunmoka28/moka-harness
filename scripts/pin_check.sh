#!/usr/bin/env bash
# Usage: pin_check.sh [marketplace.json]
# For every third-party entry: the GitHub repo exists and the pinned commit is reachable.
# Uses `gh api` (GET only). One line per failure; exit 1 on any.
set -u
M="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.claude-plugin/marketplace.json}"
[ -r "$M" ] || { echo "pin_check: cannot read $M" >&2; exit 2; }

rc=0
while IFS=$'\t' read -r name repo sha; do
  [ -n "$name" ] || continue
  if [ -z "$repo" ]; then echo "$name: source is not a GitHub repo, cannot check"; rc=1; continue; fi
  gh api "repos/$repo" >/dev/null 2>&1 || { echo "$name: repo $repo not found"; rc=1; continue; }
  gh api "repos/$repo/commits/$sha" >/dev/null 2>&1 || { echo "$name: commit $sha not reachable in $repo"; rc=1; }
done < <(python3 - "$M" <<'PY'
import json, re, sys
for p in json.load(open(sys.argv[1])).get("plugins", []):
    s = p.get("source")
    if not isinstance(s, dict): continue
    ref = s.get("repo") or s.get("url") or ""
    m = re.match(r"^(?:https?://github\.com/)?([\w.-]+/[\w.-]+?)(?:\.git)?/?$", ref)
    print("\t".join([p["name"], m.group(1) if m else "", s.get("sha", "")]))
PY
)
exit $rc
