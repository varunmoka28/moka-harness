#!/usr/bin/env bash
# `claude plugin marketplace remove` uninstalls the marketplace's plugins.
source "$(dirname "$0")/lib.sh"
sandbox_up
add_fixture
claude plugin install "bundle-test@$MARKET" >/dev/null || fail "setup install failed"
claude plugin install "unlazy@$MARKET" >/dev/null || fail "setup install failed"

claude plugin marketplace remove "$MARKET" >/dev/null || fail "marketplace remove failed"

left="$(python3 - "$SANDBOX/plugins/installed_plugins.json" "$MARKET" <<'PY'
import json, os, sys
path, market = sys.argv[1:3]
plugins = json.load(open(path)).get("plugins", {}) if os.path.exists(path) else {}
print(" ".join(sorted(k for k, v in plugins.items() if k.endswith("@" + market) and v)))
PY
)"
[ -z "$left" ] || fail "plugins still installed after marketplace remove: $left"

if [ -f "$SANDBOX/plugins/known_marketplaces.json" ]; then
  grep -q "\"$MARKET\"" "$SANDBOX/plugins/known_marketplaces.json" \
    && fail "the marketplace is still registered after remove"
fi

echo "Files left in the sandbox after remove (for the expected-leftovers list):"
( cd "$SANDBOX" && find . -type f | sort | sed 's/^/  /' )
pass "marketplace remove uninstalled every plugin, including dependencies"
