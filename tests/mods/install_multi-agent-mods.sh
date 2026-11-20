#!/usr/bin/env bash
# Installs dispatch-router, merge-gate and multi-agent-kit from a temporary marketplace, in a sandbox config folder.
source "$(dirname "$0")/../step0/lib.sh"

NAMES="dispatch-router merge-gate multi-agent-kit"
M="moka-multi-agent-test"
before="$(real_fingerprint)"
sandbox_up

MK="$SANDBOX/market"
mkdir -p "$MK/.claude-plugin" "$MK/plugins"
for n in $NAMES; do cp -R "$REPO_ROOT/plugins/$n" "$MK/plugins/$n"; done
python3 - "$REPO_ROOT/marketplace.d/multi-agent-mods.json" "$MK/.claude-plugin/marketplace.json" "$M" <<'PY'
import json, sys
entries = json.load(open(sys.argv[1]))
json.dump({"name": sys.argv[3], "owner": {"name": "moka-harness"}, "plugins": entries},
          open(sys.argv[2], "w"), indent=2)
PY

claude plugin marketplace add "$MK" >/dev/null || fail "could not add the temporary marketplace"
for n in $NAMES; do
  claude plugin install "$n@$M" >/dev/null || fail "install of $n failed"
  [ -n "$(installed_field "$n@$M" installPath)" ] || fail "$n has no install record"
  pass "$n installed"
done
[ "$before" = "$(real_fingerprint)" ] || fail "the real plugin registry changed"
pass "real plugin registry unchanged"
