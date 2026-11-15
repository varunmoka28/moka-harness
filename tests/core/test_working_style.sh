#!/usr/bin/env bash
# Run from anywhere: bash tests/core/test_working_style.sh
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
P="$ROOT/plugins/core"
F="$P/working-style.md"
fail=0
check() { if "${@:2}"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }

check "plugin validates" bash -c "cd '$ROOT' && claude plugin validate plugins/core >/dev/null 2>&1"

hook_cmd=$(jq -r '.hooks.SessionStart[0].hooks[0].command' "$P/hooks/hooks.json" 2>/dev/null)
out=$(CLAUDE_PLUGIN_ROOT="$P" bash -c "$hook_cmd" 2>/dev/null)
check "hook prints the file" test -n "$out" -a "$out" = "$(cat "$F" 2>/dev/null)"

# Denied patterns are assembled from pieces so this file holds no personal path or name.
denied=(
  "/Use""rs/" "/ho""me/"
  "20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]" "L[0-9]{4}"
  "huma""nizer" "super""powers" "Kan""zo" "her""dr" "tu""ios" "Mo""le" "claude-""mem"
  "Mem""Palace" "Ves""tige" "Byte""Rover" "peers" "BM""AD" "iC""loud" "Google Dr""ive" "rc""lone"
)
for d in "${denied[@]}"; do
  check "no match: $d" bash -c "! grep -Eiq -- '$d' '$F'"
done

# Private names are not listed here: the leak scan reads them from a file outside the repo.
check "leak scan finds nothing in the file" bash -c "cd '$ROOT' && ! bash scripts/leak_scan.sh --no-private . 2>/dev/null | grep -q 'plugins/core/working-style.md'"

words=$(wc -w < "$F" 2>/dev/null || echo 99999)
chars=$(wc -c < "$F" 2>/dev/null || echo 99999)
check "under 1500 words ($words)" test "$words" -lt 1500
check "under 10000 chars, the hook output cap ($chars)" test "$chars" -lt 10000

exit $fail
