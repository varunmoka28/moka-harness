#!/usr/bin/env bash
# A github source with a sha installs that commit, not the repo's current head.
source "$(dirname "$0")/lib.sh"
PIN="356918eba965ee1eac64bd3a7f0dd02108350de5"

head_sha="$(git ls-remote https://github.com/DietrichGebert/ponytail.git HEAD | cut -f1)"
[ -n "$head_sha" ] || fail "could not read ponytail's head commit"
[ "$head_sha" != "$PIN" ] || fail "the pin equals head, so this test cannot tell them apart; pick an older commit"

sandbox_up
add_fixture
claude plugin install "ponytail@$MARKET" >/dev/null || fail "install of ponytail@$MARKET failed"

got="$(installed_field "ponytail@$MARKET" gitCommitSha)"
[ "$got" = "$PIN" ] || fail "installed commit is '$got', expected the pin $PIN (head is $head_sha)"

path="$(installed_field "ponytail@$MARKET" installPath)"
[ -d "$path" ] || fail "install path '$path' does not exist"
case "$path" in "$SANDBOX"/*) ;; *) fail "plugin was installed outside the sandbox: $path" ;; esac

details="$(claude plugin details ponytail)" || fail "claude plugin details ponytail failed"
echo "$details" | grep -q "Skills" || fail "ponytail loaded no skills; details were: $details"
pass "ponytail installed at the pinned commit $PIN, behind head $head_sha"
