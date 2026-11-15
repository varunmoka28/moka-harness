#!/usr/bin/env bash
# Install proof: every plugin in marketplace.d/mods-d.json installs in a sandbox; the real config is untouched.
source "$(dirname "$0")/../step0/lib.sh"
before="$(real_fingerprint)"
sandbox_up
M="$SANDBOX/market"
mkdir -p "$M/.claude-plugin" "$M/plugins"
names="$(python3 - "$REPO_ROOT/marketplace.d/mods-d.json" "$M/.claude-plugin/marketplace.json" <<'PY'
import json, sys
entries = json.load(open(sys.argv[1]))
json.dump({"name": "mods-d-test", "owner": {"name": "moka-harness"}, "plugins": entries}, open(sys.argv[2], "w"))
print(" ".join(e["name"] for e in entries))
PY
)"
for n in $names; do cp -R "$REPO_ROOT/plugins/$n" "$M/plugins/$n"; done
claude plugin marketplace add "$M" >/dev/null || fail "could not add the temporary marketplace"
for n in $names; do
  claude plugin install "$n@mods-d-test" >/dev/null || fail "install failed: $n"
  path="$(installed_field "$n@mods-d-test" installPath)"
  [ -f "$path/.claude-plugin/plugin.json" ] || fail "no plugin.json in installed copy of $n: '$path'"
  case "$path" in "$SANDBOX"/*) ;; *) fail "$n installed outside the sandbox: $path" ;; esac
done
[ "$(real_fingerprint)" = "$before" ] || fail "the real plugin registry changed"
pass "mods-d ($names) install in a sandbox; real config unchanged"
