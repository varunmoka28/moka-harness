#!/usr/bin/env bash
# Every entry in marketplace.d/third-party-plugins.json installs at its pinned commit.
# Runs in a sandbox config folder; the real Claude config is never touched.
source "$(dirname "$0")/../step0/lib.sh"
ENTRIES="$REPO_ROOT/marketplace.d/third-party-plugins.json"
M="moka-tp"

real_installed="$REAL_CONFIG/plugins/installed_plugins.json"
before="$(shasum -a 256 "$real_installed" 2>/dev/null)"
sandbox_up
mkdir -p "$SANDBOX/market/.claude-plugin"
python3 - "$ENTRIES" "$SANDBOX/market/.claude-plugin/marketplace.json" "$M" <<'PY'
import json, sys
entries, out, name = sys.argv[1:4]
json.dump({"name": name, "description": "Temporary marketplace for the third-party plugin install test",
           "owner": {"name": "moka-harness"}, "plugins": json.load(open(entries))}, open(out, "w"), indent=2)
PY

# The validator may report one finding only: the reserved name claude-code-setup.
set +e; vout="$(claude plugin validate "$SANDBOX/market" 2>&1)"; set -e
findings="$(echo "$vout" | grep '^  ❯' || true)"
[ "$(echo "$findings" | grep -c .)" -eq 1 ] && echo "$findings" | grep -q 'Plugin name "claude-code-setup" is reserved' \
  || fail "validator findings were not just the claude-code-setup name: $findings"

claude plugin marketplace add "$SANDBOX/market" >/dev/null || fail "could not add the temporary marketplace"

ok=0; n=0
while IFS=$'\t' read -r name sha; do
  n=$((n+1))
  claude plugin install "$name@$M" >/dev/null 2>&1 || fail "install of $name failed"
  got="$(installed_field "$name@$M" gitCommitSha)"
  [ "$got" = "$sha" ] || fail "$name installed at '$got', expected $sha"
  path="$(installed_field "$name@$M" installPath)"
  case "$path" in "$SANDBOX"/*) ;; *) fail "$name installed outside the sandbox: $path" ;; esac
  ok=$((ok+1)); echo "ok  $name  ${sha:0:12}"
done < <(python3 -c '
import json, sys
for e in json.load(open(sys.argv[1])): print(e["name"], e["source"]["sha"], sep="\t")' "$ENTRIES")

[ "$ok" -eq "$n" ] || fail "only $ok of $n installed"
# A running Claude may refresh its own marketplaces meanwhile, so the whole registry is not hashed.
[ "$(shasum -a 256 "$real_installed" 2>/dev/null)" = "$before" ] || fail "the real installed_plugins.json changed"
! grep -q "$M" "$REAL_CONFIG/plugins/known_marketplaces.json" 2>/dev/null || fail "$M leaked into the real marketplace list"
pass "$ok of $n third-party plugins installed at their pinned commits"
