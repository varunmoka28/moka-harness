#!/usr/bin/env bash
# git-subdir source with a pin, for a plugin whose name starts with "claude-".
source "$(dirname "$0")/lib.sh"
PIN="71ddd11735d6dc38a6356fe376921fc216f2aa38"
sandbox_up
add_fixture

set +e
out="$(claude plugin install "claude-mem@$MARKET" 2>&1)"
code=$?
set -e
[ "$code" -eq 0 ] || fail "install of claude-mem@$MARKET failed (exit $code): $out"

got="$(installed_field "claude-mem@$MARKET" gitCommitSha)"
[ "$got" = "$PIN" ] || fail "claude-mem installed at '$got', expected $PIN"

path="$(installed_field "claude-mem@$MARKET" installPath)"
[ -f "$path/.claude-plugin/plugin.json" ] \
  || fail "the subfolder was not used as the plugin root: no plugin.json in $path"

listing="$(claude plugin list)" || fail "claude plugin list failed"
echo "$listing" | grep -q "claude-mem@$MARKET" || fail "claude-mem is not in the plugin list"
pass "claude-mem installed from the plugin/ subfolder at its pin, under its own name"
