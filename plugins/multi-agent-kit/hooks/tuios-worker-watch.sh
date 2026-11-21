#!/bin/bash
# Block until a tuios worker needs the orchestrator, then print why and its last screen lines.
# Usage: tuios-worker-watch.sh <window> [task.md] [verdict-file]
# Returns on: a new line starting with "STATUS: done" or "STATUS: blocked" in task.md, a "## Verdict" heading in
# the verdict file, the window gone, the agent state "done", or the agent state "needs_input" for 120 s with a
# blocking prompt on that window's screen. Without prompt text (tuios also reports needs_input while a worker waits
# on its subagents or logs an assumption note) the watch goes on, and ends only after WATCH_HARD seconds (900).
# The last one is a prompt auto mode does not answer (stale-file guard, trust question): inspect the
# conflicting edit before answering it. Run in the background and read the output when it exits.
set -u
S=${TUIOS_SESSION:-${CLAUDE_PLUGIN_OPTION_TUIOS_SESSION:-}}
[ -n "$S" ] || { echo "set TUIOS_SESSION to your tuios session name" >&2; exit 64; }
export TUIOS_SERVER=$S
W=$1; T=${2:-}; V=${3:-}
POLL=${WATCH_POLL:-20}; LIMIT=${WATCH_LIMIT:-120}; HARD=${WATCH_HARD:-900}
PROMPT_RE='Do you want to|Edit it anyway|trust this folder|Esc to cancel|\(y/n\)|Enter to confirm|❯ 1\. '

state() {
  tuios list-windows -s "$S" 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' |
    awk -F'│' -v w="$W" '{ n=$4; a=$7; gsub(/ /,"",n); gsub(/ /,"",a); if (n==w) print a }'
}
screen() { tuios capture-pane -s "$S" -w "$W" 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g'; }
count() { if [ -n "$T" ] && [ -f "$T" ]; then grep -c "$1" "$T" || true; else echo 0; fi; }

done0=$(count '^[[:space:]]*STATUS: done'); blocked0=$(count '^[[:space:]]*STATUS: blocked'); waited=0
while :; do
  s=$(state)
  if [ -z "$s" ]; then reason="window gone"; break; fi
  if [ "$(count '^[[:space:]]*STATUS: done')" -gt "$done0" ]; then reason="STATUS: done in $T"; break; fi
  if [ "$(count '^[[:space:]]*STATUS: blocked')" -gt "$blocked0" ]; then reason="STATUS: blocked in $T"; break; fi
  if [ -n "$V" ] && grep -q '^## Verdict' "$V" 2>/dev/null; then reason="verdict written to $V"; break; fi
  if [ "$s" = done ]; then reason="agent state done"; break; fi
  if [ "$s" = needs_input ]; then
    waited=$((waited + POLL))
    if [ "$waited" -ge "$LIMIT" ] && screen | tail -25 | grep -qE "$PROMPT_RE"; then
      reason="needs_input for ${waited}s with a prompt on screen: inspect it before answering"; break
    fi
    if [ "$waited" -ge "$HARD" ]; then reason="needs_input for ${waited}s, no prompt text recognised: look at the window"; break; fi
  else
    waited=0
  fi
  sleep "$POLL"
done
echo "WATCH $W: $reason"
screen | grep -v '^[[:space:]]*$' | tail -15
