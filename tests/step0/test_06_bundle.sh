#!/usr/bin/env bash
# Installing a bundle installs the pinned third-party plugins it depends on.
source "$(dirname "$0")/lib.sh"
sandbox_up
add_fixture

claude plugin install "bundle-test@$MARKET" >/dev/null || fail "install of bundle-test@$MARKET failed"

for member in ponytail humanizer; do
  [ -n "$(installed_field "$member@$MARKET" installPath)" ] \
    || fail "bundle member $member was not installed"
done
[ "$(installed_field "ponytail@$MARKET" gitCommitSha)" = "356918eba965ee1eac64bd3a7f0dd02108350de5" ] \
  || fail "bundle member ponytail did not keep its pin"
[ -z "$(installed_field "unlazy@$MARKET" installPath)" ] \
  || fail "unlazy was installed although the bundle does not depend on it"
pass "bundle-test installed ponytail and humanizer at their pins, and nothing else"
