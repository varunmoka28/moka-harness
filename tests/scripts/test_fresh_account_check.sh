#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
S="$REPO_ROOT/tests/release/fresh_account_check.sh"
h="$(tmp)"; snap="$h/snap.txt"
# Temporary HOME only; the real one is never read.
export HOME="$h/home"; unset CLAUDE_CONFIG_DIR
mkdir -p "$HOME/.claude/skills" "$HOME/.claude/plugins"
echo mine > "$HOME/.claude/CLAUDE.md"; echo '{}' > "$HOME/.claude.json"
expect_rc 0 "snapshot" bash "$S" snapshot "$snap"
expect_rc 0 "diff clean right after snapshot" bash "$S" diff "$snap"
echo x > "$HOME/.claude/skills/stray.md"
expect_rc 1 "unexpected added file fails" bash "$S" diff "$snap"
case "$OUT" in *skills/stray.md*) pass "names the added file";; *) fail "$OUT";; esac
rm "$HOME/.claude/skills/stray.md"
echo changed > "$HOME/.claude/CLAUDE.md"
expect_rc 1 "changed file fails" bash "$S" diff "$snap"
case "$OUT" in *CLAUDE.md*) pass "names the changed file";; *) fail "$OUT";; esac
echo mine > "$HOME/.claude/CLAUDE.md"
mkdir -p "$HOME/.claude/plugins/cache/m/p/1.0.0" "$HOME/.claude/backups"
touch "$HOME/.claude/plugins/cache/m/p/1.0.0/.orphaned_at" "$HOME/.claude/plugins/.last_inuse_sweep" \
  "$HOME/.claude/backups/.claude.json.backup.123"
echo '{"a":1}' > "$HOME/.claude.json"; echo '{}' > "$HOME/.claude/plugins/installed_plugins.json"
expect_rc 0 "expected leftovers pass" bash "$S" diff "$snap"
rm "$HOME/.claude/CLAUDE.md"
expect_rc 1 "removed file fails" bash "$S" diff "$snap"
