#!/bin/bash
# UserPromptSubmit: one line per window in the tuios session named by tuios_session (name, agent state,
# minutes unchanged), so the orchestrator sees every agent it has running. Prints nothing when the
# option is empty, tuios or jq is missing, or the daemon is down or empty. Read-only.
SESSION=${CLAUDE_PLUGIN_OPTION_TUIOS_SESSION:-}
[ -z "$SESSION" ] && exit 0
command -v tuios >/dev/null 2>&1 && command -v jq >/dev/null 2>&1 || exit 0
export TUIOS_SERVER=$SESSION
[ -S "${REAPER_SOCK:-/tmp/tuios-$(id -u)/servers/$SESSION/tuios.sock}" ] || exit 0
SEEN=${CLAUDE_PLUGIN_DATA:-/nonexistent}/reaper.seen
now=$(date +%s)
out=$(tuios list-windows -s "$SESSION" --json 2>/dev/null | jq -r '.windows[] | [.window_id,.display_name,.agent_state] | @tsv' | while IFS=$'\t' read -r id name state; do
  first=$(grep "^$id " "$SEEN" 2>/dev/null | cut -d' ' -f3)
  idle=""; [ -n "$first" ] && idle=", unchanged $(( (now-first)/60 )) min"
  echo "- $name: ${state:-no agent}$idle"
done)
[ -z "$out" ] && exit 0
att=$(tuios list-attention -s "$SESSION" --json 2>/dev/null | jq -r '.items[]? | "- WAITING \(.window_name // .window_id): \(.kind)"' 2>/dev/null)
printf 'tuios %s windows (close with: tuios close-window <name> -s %s):\n%s\n%s\n' "$SESSION" "$SESSION" "$out" "$att"
