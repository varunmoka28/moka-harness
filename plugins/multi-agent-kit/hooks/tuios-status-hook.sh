#!/bin/bash
# UserPromptSubmit: one line per window in the tuios session named by tuios_session, so the orchestrator sees every
# agent it has running:
#   - <name>: <agent state>, unchanged N min [ | <flag> ...]
# Prints nothing when the option is empty, tuios or jq is missing, or the daemon is down or empty. Two flags, in this
# order, ` | `-separated:
#   done, close when accepted   Claude window (foreground command `claude`), agent state not "working", and the
#                               agent's last transcript message ends with a "STATUS: done" line. The state check is
#                               here because --done-line cannot see it: a done line followed by a follow-up leaves the
#                               window working.
#   idle 24h+, close?           screen unchanged for 86400 s or more (first-seen time in the reaper's reaper.seen
#                               file). Any window, any state.
# It only flags. It never closes a window or sends anything to one.
# The done check is tuios-window-reaper.sh --done-line <cwd> <pid>, the single copy of it. Do not repeat it here.
# REAPER_SOCK overrides the socket path and REAPER_PROJECTS reaches the reaper through the environment (both used by
# tests/multi-agent-kit/test_hooks.sh).
SESSION=${CLAUDE_PLUGIN_OPTION_TUIOS_SESSION:-}
[ -z "$SESSION" ] && exit 0
command -v tuios >/dev/null 2>&1 && command -v jq >/dev/null 2>&1 || exit 0
export TUIOS_SERVER=$SESSION
[ -S "${REAPER_SOCK:-/tmp/tuios-$(id -u)/servers/$SESSION/tuios.sock}" ] || exit 0
SEEN=${CLAUDE_PLUGIN_DATA:-/nonexistent}/reaper.seen
REAPER=$(dirname "$0")/tuios-window-reaper.sh
now=$(date +%s)
# Fields are joined with \x1f, not tab: read collapses runs of tabs, so an empty agent_state would shift the rest.
out=$(tuios list-windows -s "$SESSION" --json 2>/dev/null | jq -r '.windows[] | [.window_id,.display_name,.agent_state,.pid,.cwd,.foreground_cmd] | map(. // "" | tostring) | join("\u001f")' | while IFS=$'\x1f' read -r id name state pid cwd fg; do
  first=$(grep "^$id " "$SEEN" 2>/dev/null | cut -d' ' -f3)
  idle=""; [ -n "$first" ] && idle=", unchanged $(( (now-first)/60 )) min"
  flags=""
  if [ "${fg##*/}" = claude ] && [ "$state" != working ] && bash "$REAPER" --done-line "$cwd" "$pid" </dev/null; then
    flags=" | done, close when accepted"
  fi
  if [ -n "$first" ] && [ $((now-first)) -ge 86400 ]; then flags="$flags | idle 24h+, close?"; fi
  echo "- $name: ${state:-no agent}$idle$flags"
done)
[ -z "$out" ] && exit 0
att=$(tuios list-attention -s "$SESSION" --json 2>/dev/null | jq -r '.items[]? | "- WAITING \(.name // .window): \(.kind)"' 2>/dev/null)
printf 'tuios %s windows (close with: tuios close-window <name> -s %s):\n%s\n%s\n' "$SESSION" "$SESSION" "$out" "$att"
