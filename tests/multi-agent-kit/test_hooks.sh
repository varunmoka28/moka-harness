#!/usr/bin/env bash
# Run from anywhere: bash tests/multi-agent-kit/test_hooks.sh
# Runs the multi-agent-kit hooks against a temporary HOME with a fake tuios on PATH.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
H="$ROOT/plugins/multi-agent-kit/hooks"
T="$(mktemp -d "${TMPDIR:-/tmp}/moka-kit.XXXXXX")"; T="$(cd "$T" && pwd -P)"
S="$(mktemp -d /tmp/mak.XXXXXX)"   # short path: unix sockets have a length limit
export HOME="$T/h" CLAUDE_PLUGIN_DATA="$T/data" CLAUDE_CONFIG_DIR="$T/h/.claude"
mkdir -p "$HOME" "$T/bin"
fail=0
check() { if "${@:2}"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }
logged() { grep -q -- "$1" "$CLAUDE_PLUGIN_DATA/reaper.log" 2>/dev/null; }
called() { grep -q -- "$1" "$T/calls" 2>/dev/null; }

# A fake tuios: records each call, answers from files.
cat > "$T/bin/tuios" <<'FAKE'
#!/bin/bash
echo "$*" >> "$FAKE_CALLS"
case "$1" in
  list-windows) cat "$FAKE_WINDOWS" ;;
  list-attention) cat "$FAKE_ATTN" ;;
  capture-pane) echo "a screen" ;;
esac
FAKE
chmod +x "$T/bin/tuios"
export FAKE_CALLS="$T/calls" FAKE_WINDOWS="$T/windows.json" FAKE_ATTN="$T/attn.json"
python3 -c 'import socket,sys; socket.socket(socket.AF_UNIX).bind(sys.argv[1])' "$S/tuios.sock"
export REAPER_SOCK="$S/tuios.sock"
printf '{"windows":[{"window_id":"w1","display_name":"worker","agent_state":"idle","pid":%s,"cwd":"/x","foreground_cmd":"codex"},{"window_id":"w2","display_name":"asker","agent_state":"idle","pid":%s,"cwd":"/x","foreground_cmd":"codex"}]}' $$ $$ > "$FAKE_WINDOWS"
printf '{"items":[{"window_id":"w2","kind":"question"}]}' > "$FAKE_ATTN"
export PATH="$T/bin:$PATH" CLAUDE_PLUGIN_OPTION_REAPER_IDLE_MINUTES=0
reap() { bash "$H/tuios-window-reaper.sh" "$@" >/dev/null 2>&1; }

# ---- reaper: scope ----
reap; check "no session named: does nothing" test ! -e "$CLAUDE_PLUGIN_DATA" -a ! -e "$T/calls"
export CLAUDE_PLUGIN_OPTION_TUIOS_SESSION=alpha

# ---- reaper: dry-run is the default ----
reap
check "dry-run logs would close" logged "would close worker (screen unchanged"
check "dry-run closes nothing" test ! -e "$T/calls" -o -z "$(grep close-window "$T/calls" 2>/dev/null)"
check "dry-run saves no screen" test ! -d "$CLAUDE_PLUGIN_DATA/closed"
check "a window waiting on a human is never listed" test -z "$(grep asker "$CLAUDE_PLUGIN_DATA/reaper.log" 2>/dev/null)"

# ---- reaper: switched on ----
: > "$T/calls"; : > "$CLAUDE_PLUGIN_DATA/reaper.log"; : > "$CLAUDE_PLUGIN_DATA/reaper.seen"
export CLAUDE_PLUGIN_OPTION_REAPER_DRY_RUN=false
reap
check "closes the idle window" called "close-window w1 -s alpha"
check "leaves the window waiting on a human" test -z "$(grep 'close-window w2' "$T/calls")"
check "logs the action" logged "closed worker"
check "saves the last screen" test -n "$(ls "$CLAUDE_PLUGIN_DATA/closed" 2>/dev/null)"
check "every tuios call stays in the named session" test -z "$(grep -v -e '-s alpha' "$T/calls")"

# ---- missing tools ----
: > "$T/calls"
PATH="/usr/bin:/bin" bash "$H/tuios-window-reaper.sh" >/dev/null 2>&1; check "reaper without tuios exits 0" test $? -eq 0
PATH="/usr/bin:/bin" bash "$H/tuios-status-hook.sh" >/dev/null 2>&1; check "status hook without tuios exits 0" test $? -eq 0
check "no tuios call was made" test ! -s "$T/calls"

# ---- status hook ----
out="$(bash "$H/tuios-status-hook.sh" 2>&1)"
check "status hook lists windows" test -n "$(printf '%s' "$out" | grep -- '- worker: idle')"
check "status hook shows waiting windows" test -n "$(printf '%s' "$out" | grep 'WAITING w2')"
out="$(CLAUDE_PLUGIN_OPTION_TUIOS_SESSION= bash "$H/tuios-status-hook.sh" 2>&1)"
check "status hook with no session prints nothing" test -z "$out"

exit $fail
