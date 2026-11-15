#!/usr/bin/env bash
# Every mod of batch C installs from a local marketplace in a sandbox config folder.
source "$(dirname "$0")/../step0/lib.sh"
MODS="clean-view idea-shelf noticeboard design-direction band-frame session-peers strict-guard"
MKT="moka-mods-c-test"

tmp="$(mktemp -d "${TMPDIR:-/tmp}/moka-mods-c.XXXXXX")"
mkdir -p "$tmp/.claude-plugin" "$tmp/plugins"
for m in $MODS; do cp -R "$REPO_ROOT/plugins/$m" "$tmp/plugins/$m"; done
python3 - "$REPO_ROOT/marketplace.d/mods-c.json" "$tmp/.claude-plugin/marketplace.json" "$MKT" <<'PY'
import json, sys
entries = json.load(open(sys.argv[1]))
json.dump({"name": sys.argv[3], "owner": {"name": "moka-harness"}, "plugins": entries}, open(sys.argv[2], "w"))
PY

before="$(real_fingerprint)"
sandbox_up
claude plugin marketplace add "$tmp" >/dev/null || fail "could not add the test marketplace"
for m in $MODS; do
  claude plugin install "$m@$MKT" >/dev/null || fail "install of $m failed"
  path="$(installed_field "$m@$MKT" installPath)"
  [ -d "$path" ] || fail "$m: install path '$path' does not exist"
  case "$path" in "$SANDBOX"/*) ;; *) fail "$m was installed outside the sandbox: $path" ;; esac
  pass "$m installed"
done
[ "$(real_fingerprint)" = "$before" ] || fail "the real plugin registry changed"
pass "all mods of batch C installed; the real config is unchanged"
