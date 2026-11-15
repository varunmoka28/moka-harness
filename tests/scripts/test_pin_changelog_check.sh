#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
C="$REPO_ROOT/scripts/pin_changelog_check.sh"
r="$(make_repo)"; cd "$r"
git branch base
expect_rc 0 "no change passes" bash "$C" base HEAD

write_market "$r" "$SHA_B"; git commit -qam bump
expect_rc 1 "sha change without changelog fails" bash "$C" base HEAD
case "$OUT" in *ext*) pass "failure names the entry";; *) fail "no name: $OUT";; esac

echo "- ext: moved pin after testing" >> CHANGELOG.md; git commit -qam log
expect_rc 0 "sha change with changelog line passes" bash "$C" base HEAD

git checkout -q base; git checkout -q -b other
write_market "$r" "$SHA_B"; echo "- something else" >> CHANGELOG.md; git commit -qam x
expect_rc 1 "changelog line naming another entry fails" bash "$C" base HEAD
