#!/usr/bin/env bash
# Install proof: fork-cleanup installs from a local marketplace in a sandbox, and the real config is untouched.
source "$(dirname "$0")/../step0/lib.sh"
before="$(real_fingerprint)"
sandbox_up
M="$SANDBOX/market"
mkdir -p "$M/.claude-plugin" "$M/plugins"
cp -R "$REPO_ROOT/plugins/fork-cleanup" "$M/plugins/fork-cleanup"
python3 - "$REPO_ROOT/marketplace.d/fork-cleanup.json" "$M/.claude-plugin/marketplace.json" <<'PY'
import json, sys
entries = json.load(open(sys.argv[1]))
json.dump({"name": "fc-test", "owner": {"name": "moka-harness"}, "plugins": entries}, open(sys.argv[2], "w"))
PY
claude plugin marketplace add "$M" >/dev/null || fail "could not add the temporary marketplace"
claude plugin install "fork-cleanup@fc-test" >/dev/null || fail "install failed"
path="$(installed_field "fork-cleanup@fc-test" installPath)"
[ -f "$path/hooks/fork_cleanup.sh" ] || fail "installed copy has no hook script: '$path'"
case "$path" in "$SANDBOX"/*) ;; *) fail "installed outside the sandbox: $path" ;; esac
[ "$(real_fingerprint)" = "$before" ] || fail "the real plugin registry changed"
pass "fork-cleanup installs in a sandbox; real config unchanged"
