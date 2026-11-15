#!/usr/bin/env bash
# Shared helpers for tests/scripts. Source this file; do not run it.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SHA_A=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
SHA_B=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }
tmp() { mktemp -d "${TMPDIR:-/tmp}/moka-scripts.XXXXXX"; }
# expect_rc <want> <label> <cmd...>
expect_rc() {
  local want="$1" label="$2"; shift 2
  local rc=0
  OUT="$("$@" 2>&1)" || rc=$?
  [ "$rc" -eq "$want" ] || fail "$label: exit $rc, wanted $want. Output: $OUT"
  pass "$label"
}
# a marketplace.d folder with one local plugin and one pinned third-party plugin
make_root() {
  local r; r="$(tmp)"
  mkdir -p "$r/marketplace.d" "$r/plugins/own"
  cat > "$r/marketplace.d/a.json" <<JSON
[
  {"name":"own","source":"./plugins/own","description":"mine"},
  {"name":"ext","source":{"source":"github","repo":"someone/ext","sha":"$SHA_A"},
   "description":"theirs","author":{"name":"Someone"},"license":"MIT"}
]
JSON
  echo "$r"
}
# a git repo with a marketplace.json and CHANGELOG.md committed as a base
make_repo() {
  local r; r="$(tmp)"
  git -C "$r" init -q
  git -C "$r" config user.email t"@"x.invalid; git -C "$r" config user.name t
  mkdir -p "$r/.claude-plugin"
  write_market "$r" "$SHA_A"
  echo "# Changelog" > "$r/CHANGELOG.md"
  git -C "$r" add -A; git -C "$r" commit -qm base
  echo "$r"
}
write_market() {  # <repo> <sha>
  cat > "$1/.claude-plugin/marketplace.json" <<JSON
{"name":"m","owner":{"name":"o"},"plugins":[
 {"name":"own","source":"./plugins/own"},
 {"name":"ext","source":{"source":"github","repo":"someone/ext","sha":"$2"},"author":{"name":"Someone"},"license":"MIT"}]}
JSON
}
