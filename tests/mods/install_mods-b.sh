#!/usr/bin/env bash
# Installs every mods-b plugin from a temporary local marketplace into a sandboxed Claude config.
source "$(dirname "$0")/../step0/lib.sh"

MARKET_B="moka-mods-b-test"
before="$(real_fingerprint)"
sandbox_up

tmp="$(mktemp -d "${TMPDIR:-/tmp}/moka-mods-b.XXXXXX")"
mkdir -p "$tmp/.claude-plugin" "$tmp/plugins"
names="$(python3 - "$REPO_ROOT/marketplace.d/mods-b.json" <<'PY'
import json, sys
print(" ".join(e["name"] for e in json.load(open(sys.argv[1]))))
PY
)"
[ -n "$names" ] || fail "marketplace.d/mods-b.json lists no plugins"
for n in $names; do cp -R "$REPO_ROOT/plugins/$n" "$tmp/plugins/$n"; done

python3 - "$REPO_ROOT/marketplace.d/mods-b.json" "$tmp/.claude-plugin/marketplace.json" "$MARKET_B" <<'PY'
import json, sys
entries = json.load(open(sys.argv[1]))
json.dump({"name": sys.argv[3], "owner": {"name": "moka-harness"}, "plugins": entries},
          open(sys.argv[2], "w"), indent=2)
PY

claude plugin validate "$tmp" >/dev/null || fail "the temporary marketplace did not validate"
claude plugin marketplace add "$tmp" >/dev/null || fail "could not add the temporary marketplace"

for n in $names; do
  claude plugin install "$n@$MARKET_B" >/dev/null || fail "install of $n failed"
  path="$(installed_field "$n@$MARKET_B" installPath)"
  [ -n "$path" ] && [ -f "$path/.claude-plugin/plugin.json" ] || fail "$n has no install record or no plugin.json at its install path"
  pass "$n installed"
done

[ "$(real_fingerprint)" = "$before" ] || fail "the real Claude config changed"
pass "all mods-b plugins installed in the sandbox; the real config is unchanged"
