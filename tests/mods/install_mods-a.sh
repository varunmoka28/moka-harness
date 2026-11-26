#!/usr/bin/env bash
# Installs every mod of batch A from a temporary marketplace, in a sandbox config folder.
source "$(dirname "$0")/../step0/lib.sh"

NAMES="assumption-log collision-guard context-guard cache-clock image-shrinker input-router read-fence skills-az disabled-index"
M="moka-mods-a-test"
before="$(real_fingerprint)"
sandbox_up

# A temporary marketplace holding the plugins, with the entries from marketplace.d/mods-a.json.
MK="$SANDBOX/market"
mkdir -p "$MK/.claude-plugin" "$MK/plugins"
for n in $NAMES; do cp -R "$REPO_ROOT/plugins/$n" "$MK/plugins/$n"; done
# cache-clock depends on unattended and layman, which ship in other batches: stand-ins here.
for n in unattended layman; do
  mkdir -p "$MK/plugins/$n/.claude-plugin"
  echo "{\"name\":\"$n\",\"version\":\"0.0.0\",\"description\":\"stand-in for the dependency test\"}" > "$MK/plugins/$n/.claude-plugin/plugin.json"
done
python3 - "$REPO_ROOT/marketplace.d/mods-a.json" "$MK/.claude-plugin/marketplace.json" "$M" <<'PY'
import json, sys
entries = json.load(open(sys.argv[1]))
for n in ("unattended", "layman"):
    entries.append({"name": n, "source": "./plugins/" + n, "description": "stand-in"})
json.dump({"name": sys.argv[3], "owner": {"name": "moka-harness"}, "plugins": entries},
          open(sys.argv[2], "w"), indent=2)
PY

claude plugin marketplace add "$MK" >/dev/null || fail "could not add the temporary marketplace"
for n in $NAMES; do
  claude plugin install "$n@$M" >/dev/null || fail "install of $n failed"
  [ -n "$(installed_field "$n@$M" installPath)" ] || fail "$n has no install record"
  pass "$n installed"
done
for n in unattended layman; do
  [ -n "$(installed_field "$n@$M" installPath)" ] || fail "dependency $n was not installed with cache-clock"
done
pass "cache-clock pulled in its dependencies unattended and layman"
[ "$before" = "$(real_fingerprint)" ] || fail "the real plugin registry changed"
pass "real plugin registry unchanged"
