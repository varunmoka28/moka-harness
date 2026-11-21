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
# worker: an agent that has been working for over 2 hours (a runaway). idler: no change on its screen for 25 hours.
printf '{"windows":[{"window_id":"w1","display_name":"worker","agent_state":"working","pid":%s,"cwd":"/x","foreground_cmd":"codex"},{"window_id":"w2","display_name":"asker","agent_state":"idle","pid":%s,"cwd":"/x","foreground_cmd":"codex"},{"window_id":"w3","display_name":"idler","agent_state":"idle","pid":%s,"cwd":"/x","foreground_cmd":"codex"}]}' $$ $$ $$ > "$FAKE_WINDOWS"
printf '{"items":[{"window":"w2","name":"asker","kind":"question"}]}' > "$FAKE_ATTN"
export PATH="$T/bin:$PATH"
reap() { bash "$H/tuios-window-reaper.sh" "$@" >/dev/null 2>&1; }
seed() { mkdir -p "$CLAUDE_PLUGIN_DATA"; echo "w1 $(( $(date +%s) - 8000 ))" > "$CLAUDE_PLUGIN_DATA/reaper.work"; echo "w3 $(md5 -q -s 'a screen') $(( $(date +%s) - 90000 ))" > "$CLAUDE_PLUGIN_DATA/reaper.seen"; }

# ---- reaper: scope ----
reap; check "no session named: does nothing" test ! -e "$CLAUDE_PLUGIN_DATA" -a ! -e "$T/calls"
export CLAUDE_PLUGIN_OPTION_TUIOS_SESSION=alpha

# ---- reaper: dry-run is the default ----
seed; reap
check "dry-run logs would close" logged "would close worker (working"
check "an idle window is not a reason to close" test -z "$(grep idler "$CLAUDE_PLUGIN_DATA/reaper.log" 2>/dev/null)"
check "dry-run closes nothing" test ! -e "$T/calls" -o -z "$(grep close-window "$T/calls" 2>/dev/null)"
check "dry-run saves no screen" test ! -d "$CLAUDE_PLUGIN_DATA/closed"
check "a window waiting on a human is never listed" test -z "$(grep asker "$CLAUDE_PLUGIN_DATA/reaper.log" 2>/dev/null)"

# ---- reaper: switched on ----
: > "$T/calls"; : > "$CLAUDE_PLUGIN_DATA/reaper.log"; seed   # a dry-run drops the working entry, so seed it again
export CLAUDE_PLUGIN_OPTION_REAPER_DRY_RUN=false
reap
check "closes the runaway window" called "close-window w1 -s alpha"
check "leaves the idle window open" test -z "$(grep 'close-window w3' "$T/calls")"
check "leaves the window waiting on a human" test -z "$(grep 'close-window w2' "$T/calls")"
check "logs the action" logged "closed worker"
check "saves the last screen" test -n "$(ls "$CLAUDE_PLUGIN_DATA/closed" 2>/dev/null)"
check "every tuios call stays in the named session" test -z "$(grep -v -e '-s alpha' "$T/calls")"

# ---- missing tools ----
: > "$T/calls"
PATH="/usr/bin:/bin" bash "$H/tuios-window-reaper.sh" >/dev/null 2>&1; check "reaper without tuios exits 0" test $? -eq 0
PATH="/usr/bin:/bin" bash "$H/tuios-status-hook.sh" >/dev/null 2>&1; check "status hook without tuios exits 0" test $? -eq 0
check "no tuios call was made" test ! -s "$T/calls"

# ---- reaper --done-line ----
CWD="$T/cwd"; mkdir -p "$CWD"; SLUG=$(printf '%s' "$CWD" | sed 's/[^A-Za-z0-9]/-/g'); mkdir -p "$CLAUDE_CONFIG_DIR/projects/$SLUG"
transcript() { jq -cn --arg t "$1" '{type:"assistant", message:{content:[{type:"text", text:$t}]}}' > "$CLAUDE_CONFIG_DIR/projects/$SLUG/s.jsonl"; }
done_line() { bash "$H/tuios-window-reaper.sh" --done-line "$CWD" $$; }
bare_done_line() { env -u CLAUDE_PLUGIN_DATA -u CLAUDE_PLUGIN_OPTION_TUIOS_SESSION bash "$H/tuios-window-reaper.sh" --done-line "$@"; }
: > "$T/calls"
transcript $'All pass.\n\nSTATUS: done'
check "done-line exits 0 when the last message ends with STATUS: done" done_line
check "done-line works with no session and no plugin data" bare_done_line "$CWD" $$
transcript $'The brief says to end with "STATUS: done" once tests pass.\nSTATUS: blocked'
check "done-line exits 1, silently, when STATUS: done is only quoted" test "$(done_line; echo $?)" = 1
check "done-line exits 1 with no transcript and no guards" test "$(bare_done_line /nonexistent $$; echo $?)" = 1
check "done-line makes no tuios call" test ! -s "$T/calls"

# ---- status hook ----
out="$(bash "$H/tuios-status-hook.sh" 2>&1)"
check "status hook lists windows" test -n "$(printf '%s' "$out" | grep -- '- worker: working')"
check "status hook shows the waiting window by name" test -n "$(printf '%s' "$out" | grep 'WAITING asker: question')"
check "status hook flags a window idle for 24h+" test -n "$(printf '%s' "$out" | grep -F -- '- idler: idle, unchanged 1500 min | idle 24h+, close?')"
printf '{"windows":[{"window_id":"w9","display_name":"agent","agent_state":"done","pid":%s,"cwd":"%s","foreground_cmd":"claude"}]}' $$ "$CWD" > "$FAKE_WINDOWS"
: > "$T/calls"; : > "$CLAUDE_PLUGIN_DATA/reaper.seen"
transcript $'All pass.\n\nSTATUS: done'
out="$(bash "$H/tuios-status-hook.sh" 2>&1)"
check "status hook flags a done Claude window" test -n "$(printf '%s' "$out" | grep -F -- '- agent: done | done, close when accepted')"
printf '{"windows":[{"window_id":"w9","display_name":"agent","agent_state":"working","pid":%s,"cwd":"%s","foreground_cmd":"claude"}]}' $$ "$CWD" > "$FAKE_WINDOWS"
out="$(bash "$H/tuios-status-hook.sh" 2>&1)"
check "status hook does not flag a working window as done" test -z "$(printf '%s' "$out" | grep 'close when accepted')"
check "status hook never closes or sends" test -z "$(grep -E 'close-window|send' "$T/calls")"
out="$(CLAUDE_PLUGIN_OPTION_TUIOS_SESSION= bash "$H/tuios-status-hook.sh" 2>&1)"
check "status hook with no session prints nothing" test -z "$out"

# ---- worker-watch ----
# A stub tuios for the watcher: one window whose state is read from $T/wstate and whose screen is $T/wscreen.
mkdir -p "$T/wbin"
cat > "$T/wbin/tuios" <<STUB
#!/bin/bash
case "\$1" in
  list-windows) echo x >> "$T/wcalls"; echo "│ *0  │ 9587f20d │ testwin │ 1  │ 88x59  │ \$(cat "$T/wstate") │" ;;
  capture-pane) echo "\$*" >> "$T/wcapture"; cat "$T/wscreen" ;;
esac
STUB
chmod +x "$T/wbin/tuios"
startwatch() {  # fresh task file and stub state, then run the watcher in the background until its first poll
  printf 'plan: neutral line\n' > "$T/task.md"; : > "$T/wcalls"; : > "$T/wout"; : > "$T/wcapture"
  echo working > "$T/wstate"; echo "last screen line" > "$T/wscreen"
  PATH="$T/wbin:$PATH" WATCH_POLL=1 WATCH_LIMIT=2 WATCH_HARD=5 bash "$H/tuios-worker-watch.sh" testwin "$T/task.md" > "$T/wout" 2>&1 & wpid=$!
  for _ in $(seq 50); do [ -s "$T/wcalls" ] && break; sleep 0.1; done
}
stopwatch() { kill "$wpid" 2>/dev/null; wait "$wpid" 2>/dev/null; }
running() { kill -0 "$wpid" 2>/dev/null; }
ended_with() { for _ in $(seq 70); do running || break; sleep 0.1; done; ! running && grep -q -- "$1" "$T/wout"; }

startwatch; printf 'the worker ends with STATUS: done once tests pass\n' >> "$T/task.md"; sleep 3
check "worker-watch ignores a status phrase in the middle of a line" running; stopwatch
startwatch; printf '  STATUS: done\n' >> "$T/task.md"
check "worker-watch ends on an indented STATUS: done line" ended_with "WATCH testwin: STATUS: done in $T/task.md"
check "worker-watch reads the named window's screen" grep -q -e '-w testwin' "$T/wcapture"; stopwatch
startwatch; echo needs_input > "$T/wstate"; printf 'Noted as A3. The user can see it.\n' > "$T/wscreen"; sleep 3.5
check "worker-watch keeps going on needs_input with no prompt on screen" running
check "worker-watch ends at WATCH_HARD when no prompt is recognised" ended_with "no prompt text recognised"; stopwatch
startwatch; echo needs_input > "$T/wstate"; printf 'Do you want to proceed?\n❯ 1. Yes\n  2. No\n' > "$T/wscreen"
check "worker-watch ends on needs_input with a prompt on screen" ended_with "with a prompt on screen"; stopwatch

exit $fail
