#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
r="$(make_repo)"; M="$r/.claude-plugin/marketplace.json"
bin="$(tmp)"
cat > "$bin/gh" <<'EOF2'
#!/usr/bin/env bash
# fake gh: GET only. FAKE_GH_FAIL is a substring that makes a call fail.
[ "$1" = api ] || exit 9
case "$2" in *"${FAKE_GH_FAIL:-@@none@@}"*) exit 1 ;; esac
echo '{}'
EOF2
chmod +x "$bin/gh"
export PATH="$bin:$PATH"
P="$REPO_ROOT/scripts/pin_check.sh"
expect_rc 0 "all reachable passes" bash "$P" "$M"
FAKE_GH_FAIL="commits/$SHA_A" expect_rc 1 "unreachable commit fails" bash "$P" "$M"
case "$OUT" in *ext*commit*) pass "line names entry and commit";; *) fail "$OUT";; esac
FAKE_GH_FAIL="repos/someone/ext" expect_rc 1 "missing repo fails" bash "$P" "$M"
case "$OUT" in *ext*not\ found*) pass "line says repo not found";; *) fail "$OUT";; esac
