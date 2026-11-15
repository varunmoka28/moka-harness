#!/usr/bin/env bash
# Run from anywhere: bash tests/core/test_doctor.sh
# Runs the doctor check against a temporary config folder and a PATH of fake tools.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CHECK="$ROOT/plugins/core/skills/doctor/check.sh"
T="$(mktemp -d "${TMPDIR:-/tmp}/moka-doctor.XXXXXX")"
export HOME="$T/home" CLAUDE_CONFIG_DIR="$T/cfg"
mkdir -p "$HOME" "$CLAUDE_CONFIG_DIR/plugins" "$T/bin"
ln -s "$(command -v jq)" "$T/bin/jq"
export PATH="$T/bin:/usr/bin:/bin"
unset TYPESAFE_API_KEY AWS_PROFILE AWS_ACCESS_KEY_ID
fail=0
check() { if "${@:2}"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }
run() { out="$(bash "$CHECK" 2>&1)"; rc=$?; }
record() { # record <plugin>... writes the install record
  printf '{"version":2,"plugins":{' > "$CLAUDE_CONFIG_DIR/plugins/installed_plugins.json"
  local sep=""; for p in "$@"; do printf '%s"%s@moka-harness":[{"scope":"user"}]' "$sep" "$p" >> "$CLAUDE_CONFIG_DIR/plugins/installed_plugins.json"; sep=","; done
  printf '}}' >> "$CLAUDE_CONFIG_DIR/plugins/installed_plugins.json"
}

run; check "no install record: nothing to check, exit 0" test $rc -eq 0 -a -n "$out" -a "$out" = "${out%missing*}"
record; run; check "empty record: exit 0, no missing" test $rc -eq 0 -a "$out" = "${out%missing*}"

record multi-agent; touch "$T/bin/herdr"; chmod +x "$T/bin/herdr"
run
check "missing tool: exit 1" test $rc -eq 1
check "missing tool: reported with how to get it" grep -q 'missing .*tuios.*brew install tuios' <<<"$out"
check "present tool: reported ok" grep -q 'ok .*herdr' <<<"$out"
check "other groups not checked" test "$out" = "${out%ffmpeg*}"

touch "$T/bin/tuios"; chmod +x "$T/bin/tuios"
run; check "all tools on PATH: exit 0" test $rc -eq 0
check "all tools on PATH: nothing missing" test "$out" = "${out%missing*}"

record jev; run
check "missing key: exit 1" test $rc -eq 1
check "missing key: reported by name" grep -q 'missing .*TYPESAFE_API_KEY' <<<"$out"
export TYPESAFE_API_KEY="secret-value-123"; run
check "key set: exit 0" test $rc -eq 0
check "key set: ok line" grep -q 'ok .*TYPESAFE_API_KEY' <<<"$out"
check "key value never printed" test "$out" = "${out%secret-value-123*}"

record cloud; run; check "no cloud credentials: exit 1" test $rc -eq 1
export AWS_PROFILE=x; run; check "cloud credentials via profile: exit 0" test $rc -eq 0

exit $fail
