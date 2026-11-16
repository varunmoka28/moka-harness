#!/usr/bin/env bash
# Install proof for the core plugin, in a sandboxed Claude config.
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$ROOT/tests/step0/lib.sh"
before=$(real_fingerprint)
sandbox_up
M="$(mktemp -d "${TMPDIR:-/tmp}/moka-core-market.XXXXXX")"
mkdir -p "$M/.claude-plugin" "$M/plugins"
cp -R "$ROOT/plugins/core" "$M/plugins/core"
cp -R "$ROOT/plugins/band-frame" "$M/plugins/band-frame"
cat > "$M/.claude-plugin/marketplace.json" <<'JSON'
{ "name": "moka-core-test", "owner": { "name": "moka-harness" },
  "plugins": [ { "name": "core", "source": "./plugins/core", "description": "core" },
    { "name": "band-frame", "source": "./plugins/band-frame", "description": "band-frame" } ] }
JSON
claude plugin marketplace add "$M" >/dev/null || fail "marketplace add"
claude plugin install core@moka-core-test >/dev/null || fail "install core"
[ -n "$(installed_field core@moka-core-test version)" ] || fail "no install record for core"
[ "$before" = "$(real_fingerprint)" ] || fail "real config changed"
[ -n "$(installed_field band-frame@moka-core-test version)" ] || fail "core did not pull in band-frame"
pass "core installed in the sandbox; real config unchanged"
