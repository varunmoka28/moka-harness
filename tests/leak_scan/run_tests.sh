#!/usr/bin/env bash
# Tests for scripts/leak_scan.sh. Each test builds a temp git repo, plants one leak,
# and checks the scanner's exit code and output. Temp dirs live under $TMPDIR (the
# OS clears them); nothing in the real home directory is read or written.
# Leak strings are assembled at run time so this file stays clean under its own scan.
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
FIXTURES="$HERE/fixtures"

PASS=0
FAIL=0
OUT=""
RC=0
REPO=""
DENY=""

# new_repo: temp git repo with the scanner's scripts copied in (untracked, so not scanned)
# and a temp denylist holding two made-up terms.
new_repo() {
  REPO="$(mktemp -d)"
  git -C "$REPO" init -q
  mkdir -p "$REPO/scripts"
  cp "$ROOT/scripts/leak_scan.sh" "$ROOT/scripts/leak_patterns.txt" "$ROOT/scripts/leak_allow.txt" "$REPO/scripts/" 2>/dev/null
  DENY="$(mktemp)"
  printf '# made-up terms\n\nacme-secret-client\nZeta-Project-X\n' > "$DENY"
}

# plant <relpath> <content>: write a file and stage it.
plant() {
  mkdir -p "$REPO/$(dirname "$1")"
  printf '%s\n' "$2" > "$REPO/$1"
  git -C "$REPO" add "$1"
}

# scan [args...]: run the scanner on the temp repo, capture OUT and RC.
scan() {
  OUT="$(MOKA_HARNESS_DENYLIST="$DENY" bash "$REPO/scripts/leak_scan.sh" "$@" "$REPO" 2>&1)"
  RC=$?
}

check() { # check <test name> <condition result 0/1> [detail]
  if [ "$2" -eq 0 ]; then
    PASS=$((PASS + 1)); echo "ok   $1"
  else
    FAIL=$((FAIL + 1)); echo "FAIL $1"; echo "     rc=$RC out=[$OUT] ${3:-}"
  fi
}

expect_hit() { # expect_hit <test name> <pattern name>
  local ok=1
  [ "$RC" -eq 1 ] && printf '%s' "$OUT" | grep -qF "f.txt:1: $2" && ok=0
  check "$1" "$ok"
}

# --- generic patterns ---------------------------------------------------------------
H1="/Us""ers/someone"
H2="/ho""me/someone"
KSK="sk""-abcdefghijklmnopqrstuvwx"
KGH="gh""p_abcdefghijklmnopqrstuvwxyz0123456789"
KPAT="github""_pat_abcdefghijklmnopqrstuvwxyz0123456789"
KAWS="AK""IAABCDEFGHIJKLMNOP"
KSB="xo""xb-1234567890-abcdefghij"
KSP="xo""xp-1234567890-abcdefghij"
KPEM="-----BEGIN RSA PRIV""ATE KEY-----"

new_repo; plant f.txt "see $H1/notes"; scan;                        expect_hit "mac home path" home_path_mac
new_repo; plant f.txt "see $H2/notes"; scan;                        expect_hit "linux home path" home_path_linux
new_repo; plant f.txt "write to name""@example.org please"; scan;   expect_hit "email address" email
new_repo; plant f.txt "as noted in L""0123 earlier"; scan;          expect_hit "lesson id" lesson_id
new_repo; plant f.txt "k=$KSK"; scan;                               expect_hit "key sk-" key_sk
new_repo; plant f.txt "t=$KGH"; scan;                               expect_hit "key ghp_" key_ghp
new_repo; plant f.txt "t=$KPAT"; scan;                              expect_hit "key github_pat_" key_github_pat
new_repo; plant f.txt "id=$KAWS"; scan;                             expect_hit "key AKIA" key_aws
new_repo; plant f.txt "t=$KSB"; scan;                               expect_hit "key xoxb-" key_slack
new_repo; plant f.txt "t=$KSP"; scan;                               expect_hit "key xoxp-" key_slack
new_repo; plant f.txt "$KPEM"; scan;                                expect_hit "private key block" private_key

new_repo; plant f.txt "L12345 and AL0123"; scan
check "lesson id needs exactly four digits and a word edge" $([ "$RC" -eq 0 ] && echo 0 || echo 1)

# --- private terms --------------------------------------------------------------------
new_repo; plant f.txt "client is acme-secret-client today"; scan
ok=1; [ "$RC" -eq 1 ] && printf '%s' "$OUT" | grep -qF "f.txt:1: private term #3" && ok=0
check "private term hit names the denylist line" "$ok"

new_repo; plant f.txt "client is ACME-Secret-CLIENT today"; scan
ok=1; [ "$RC" -eq 1 ] && printf '%s' "$OUT" | grep -qF "f.txt:1: private term #3" && ok=0
check "private term matches case-insensitively" "$ok"

new_repo; plant f.txt "line one"; plant g.txt "x
y zeta-project-x"; scan
ok=1; [ "$RC" -eq 1 ] && printf '%s' "$OUT" | grep -qF "g.txt:2: private term #4" && ok=0
check "second term and later line number" "$ok"

new_repo; plant f.txt "a comment line mentions nothing; blank lines ignored"; scan
check "comment and blank denylist lines are not terms" $([ "$RC" -eq 0 ] && echo 0 || echo 1)

new_repo; plant f.txt "client is acme-secret-client and Zeta-Project-X"; scan
ok=0
printf '%s' "$OUT" | grep -qi "acme-secret-client" && ok=1
printf '%s' "$OUT" | grep -qi "zeta-project-x" && ok=1
check "private term text never appears in output" "$ok"

# --- exit codes and flags -------------------------------------------------------------
new_repo; plant clean.txt "$(cat "$FIXTURES/clean.txt")"; scan
check "clean repo exits 0" $([ "$RC" -eq 0 ] && echo 0 || echo 1)

new_repo; plant f.txt "fine"; DENY="$REPO/does-not-exist.txt"; scan
ok=1; [ "$RC" -eq 2 ] && printf '%s' "$OUT" | grep -qi "denylist" && ok=0
check "missing denylist exits 2 with a message" "$ok"

new_repo; plant f.txt "client is acme-secret-client"; scan --no-private
ok=1; [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -qi "warning" && ok=0
check "--no-private skips private terms and warns" "$ok"

new_repo; plant f.txt "see $H1/x"; DENY="$REPO/does-not-exist.txt"; scan --no-private
ok=1; [ "$RC" -eq 1 ] && printf '%s' "$OUT" | grep -qF "f.txt:1: home_path_mac" && ok=0
check "--no-private still runs generic patterns, no denylist needed" "$ok"

new_repo; plant tests/leak_scan/fixtures/x.txt "see $H1/x and acme-secret-client"; scan
check "shipped allowlist skips tests/leak_scan/fixtures" $([ "$RC" -eq 0 ] && echo 0 || echo 1)

new_repo; plant docs/x.txt "see $H1/x"; printf '# comment\ndocs/*\n' > "$REPO/scripts/leak_allow.txt"; scan
check "custom allow glob skips a path" $([ "$RC" -eq 0 ] && echo 0 || echo 1)

new_repo; printf '%s\n' "see $H1/x" > "$REPO/untracked.txt"; scan
check "untracked file is ignored" $([ "$RC" -eq 0 ] && echo 0 || echo 1)

new_repo; printf '\000%s\n' "$H1/x" > "$REPO/bin.dat"; git -C "$REPO" add bin.dat; scan
check "binary file is skipped" $([ "$RC" -eq 0 ] && echo 0 || echo 1)

new_repo; OUT="$(MOKA_HARNESS_DENYLIST="$DENY" bash "$REPO/scripts/leak_scan.sh" "$REPO/nope" 2>&1)"; RC=$?
check "bad directory exits 2" $([ "$RC" -eq 2 ] && echo 0 || echo 1)

echo
echo "passed: $PASS  failed: $FAIL"
[ "$FAIL" -eq 0 ]
