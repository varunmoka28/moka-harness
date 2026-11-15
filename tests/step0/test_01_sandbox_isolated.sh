#!/usr/bin/env bash
# The sandbox must take every plugin write, and the real config must not change.
source "$(dirname "$0")/lib.sh"

before="$(real_fingerprint)"
sandbox_up
[ -n "$SANDBOX" ] && [ -d "$SANDBOX" ] || fail "sandbox folder was not created"
[ "$CLAUDE_CONFIG_DIR" = "$SANDBOX" ] || fail "CLAUDE_CONFIG_DIR does not point at the sandbox"

add_fixture
[ -f "$SANDBOX/plugins/known_marketplaces.json" ] \
  || fail "marketplace was not recorded inside the sandbox"
grep -q "\"$MARKET\"" "$SANDBOX/plugins/known_marketplaces.json" \
  || fail "sandbox registry does not name $MARKET"

after="$(real_fingerprint)"
[ "$before" = "$after" ] || fail "the real Claude config changed while the sandbox was in use"
pass "sandbox takes the writes and the real config is unchanged"
