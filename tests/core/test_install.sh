#!/usr/bin/env bash
# Install proof for the core plugin, in a sandboxed Claude config.
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$ROOT/tests/step0/lib.sh"
before=$(real_fingerprint)
sandbox_up
M="$(mktemp -d "${TMPDIR:-/tmp}/moka-core-market.XXXXXX")"
mkdir -p "$M/.claude-plugin" "$M/plugins"
cp -R "$ROOT/plugins/core" "$M/plugins/core"
cat > "$M/.claude-plugin/marketplace.json" <<'JSON'
{ "name": "moka-core-test", "owner": { "name": "moka-harness" },
  "plugins": [ { "name": "core", "source": "./plugins/core", "description": "core" } ] }
JSON
claude plugin marketplace add "$M" >/dev/null || fail "marketplace add"
claude plugin install core@moka-core-test >/dev/null || fail "install core"
[ -n "$(installed_field core@moka-core-test version)" ] || fail "no install record for core"
[ "$before" = "$(real_fingerprint)" ] || fail "real config changed"
pass "core installed in the sandbox; real config unchanged"
