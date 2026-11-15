#!/usr/bin/env bash
# Install proof: prompt-enhancer and run-ledger install from a local marketplace in a sandbox, and the real config is untouched.
source "$(dirname "$0")/../step0/lib.sh"
before="$(real_fingerprint)"
sandbox_up
M="$SANDBOX/market"
mkdir -p "$M/.claude-plugin" "$M/plugins"
for p in prompt-enhancer run-ledger; do cp -R "$REPO_ROOT/plugins/$p" "$M/plugins/$p"; done
python3 - "$REPO_ROOT/marketplace.d/jev-mods.json" "$M/.claude-plugin/marketplace.json" <<'PY'
import json, sys
entries = json.load(open(sys.argv[1]))
json.dump({"name": "jev-test", "owner": {"name": "moka-harness"}, "plugins": entries}, open(sys.argv[2], "w"))
PY
claude plugin marketplace add "$M" >/dev/null || fail "could not add the temporary marketplace"
for p in prompt-enhancer run-ledger; do
  claude plugin install "$p@jev-test" >/dev/null || fail "install of $p failed"
  path="$(installed_field "$p@jev-test" installPath)"
  case "$path" in "$SANDBOX"/*) ;; *) fail "$p installed outside the sandbox: $path" ;; esac
  [ -f "$path/hooks/register.tsx" ] || fail "$p: installed copy has no hooks/register.tsx"
done
[ -f "$(installed_field prompt-enhancer@jev-test installPath)/hooks/jev-skill-router.py" ] || fail "router not installed with prompt-enhancer"
[ "$(real_fingerprint)" = "$before" ] || fail "the real plugin registry changed"
pass "prompt-enhancer and run-ledger install in a sandbox; real config unchanged"
