#!/usr/bin/env bash
# A skill repo installs as a plugin whether or not it carries its own plugin.json.
source "$(dirname "$0")/lib.sh"
sandbox_up
add_fixture

check_skill_plugin() { # check_skill_plugin <entry-name> <pinned-sha>
  local name="$1" pin="$2" got details
  claude plugin install "$name@$MARKET" >/dev/null || fail "install of $name@$MARKET failed"
  got="$(installed_field "$name@$MARKET" gitCommitSha)"
  [ "$got" = "$pin" ] || fail "$name installed at '$got', expected $pin"
  details="$(claude plugin details "$name")" || fail "claude plugin details $name failed"
  echo "$details" | grep -Eq "Skills \([1-9]" \
    || fail "$name loaded no skill; details were: $details"
  pass "$name installed at its pin and loads at least one skill"
}

check_skill_plugin humanizer b48c832f0f809c1b5658edbb838c2521b72f2413
check_skill_plugin unlazy    16671491f6679ad9378f52604d3bc2415b4120c7
