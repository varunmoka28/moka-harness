#!/bin/bash
# SessionStart + Stop: close tuios windows, in the one tuios session the user named, that are finished or empty.
#   1. no agent in it: a bare shell with no child process
#   2. a Claude window whose agent has finished its turn and whose own last message ends with a line
#      "STATUS: done" (read from the agent's transcript, never from the screen: the screen also shows
#      what was typed into it, and a typed "end with STATUS: done." could close a healthy worker).
#      Windows without a transcript (agy, Codex) have no completion rule and stay open until rule 3.
#   3. screen unchanged for reaper_idle_minutes and the agent is not working
#   4. agent in "working" state for over 2 hours (a runaway), unless the window's name is listed in
#      ${CLAUDE_PLUGIN_DATA}/reaper.keep (one name per line)
# Never touches a window listed in `tuios list-attention` (approval, question, plan, error).
# The last screen of each closed window goes to ${CLAUDE_PLUGIN_DATA}/closed/.
# When no windows remain and herdr_tab_label is set, closes the herdr tab with that label.
#
# It closes things, so: it does nothing until tuios_session names a session; it only reports
# ("would close") until reaper_dry_run is switched off; every action goes to
# ${CLAUDE_PLUGIN_DATA}/reaper.log. Needs tuios and jq; with either missing it does nothing.
# macOS: uses md5 and stat -f.
# REAPER_SOCK overrides the daemon socket path (used by tests/test_reaper.sh).
set -u
SESSION=${CLAUDE_PLUGIN_OPTION_TUIOS_SESSION:-}
[ -z "$SESSION" ] && exit 0
command -v tuios >/dev/null 2>&1 && command -v jq >/dev/null 2>&1 || exit 0
STATE=${CLAUDE_PLUGIN_DATA:-}
[ -z "$STATE" ] && { echo "multi-agent-kit reaper: CLAUDE_PLUGIN_DATA not set, no log possible, doing nothing"; exit 0; }
export TUIOS_SERVER=$SESSION
case "$(printf '%s' "${CLAUDE_PLUGIN_OPTION_REAPER_DRY_RUN:-true}" | tr 'A-Z' 'a-z')" in
  false|0|no|off) DRY=0 ;; *) DRY=1 ;;
esac
[ "${1:-}" = --dry-run ] && DRY=1
IDLE=$(awk -v m="${CLAUDE_PLUGIN_OPTION_REAPER_IDLE_MINUTES:-15}" 'BEGIN{ if (m+0 >= 0) printf "%d", m*60; else print 900 }')
CAP=7200
PROJECTS=${REAPER_PROJECTS:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects}
SOCK=${REAPER_SOCK:-/tmp/tuios-$(id -u)/servers/$SESSION/tuios.sock}
LOG=$STATE/reaper.log
SEEN=$STATE/reaper.seen   # "<window_id> <screen md5> <first-seen epoch>"
WORK=$STATE/reaper.work   # "<window_id> <first-seen-working epoch>"
KEEP=$STATE/reaper.keep   # window names exempt from the working cap
mkdir -p "$STATE"

[ -S "$SOCK" ] || exit 0   # no daemon: do not start one
now=$(date +%s)
say() { # $1 what, $2 reason
  local verb="closed"; [ $DRY = 1 ] && verb="would close"
  echo "$(date '+%F %T') $verb $1 ($2)" >> "$LOG"
  [ $DRY = 1 ] && echo "multi-agent-kit reaper: would close $1 ($2)"
}

# The last non-empty line of the agent's own last message, from its transcript. Empty when there is none.
# $1 cwd, $2 pid: only a transcript written since this window's process started counts, because two windows in
# the same folder share the transcript folder and a fresh window has no transcript of its own until its first turn.
agent_last_line() {
  local slug f started
  slug=$(printf '%s' "$1" | sed 's/[^A-Za-z0-9]/-/g')
  # macOS ps has no etimes; etime is [[dd-]hh:]mm:ss
  started=$(( now - $(ps -o etime= -p "$2" 2>/dev/null | awk -F'[-:]' '{s=0; for(i=1;i<=NF;i++) s=s*(i==2&&NF==4?24:60)+$i; print s+0}') ))
  f=$(ls -t "$PROJECTS/$slug"/*.jsonl 2>/dev/null | head -1)
  [ -n "$f" ] || return 0
  [ "$(stat -f %m "$f")" -ge "$started" ] || return 0
  jq -r 'select(.type=="assistant") | [.message.content[]? | select(.type=="text") | .text] | join("\n")' "$f" 2>/dev/null \
    | grep -v '^[[:space:]]*$' | tail -n 1
}

windows=$(tuios list-windows -s "$SESSION" --json 2>/dev/null) || exit 0
attention=$(tuios list-attention -s "$SESSION" --kind approval,plan,ask,question,errored --json 2>/dev/null | jq -c '.items[]?' 2>/dev/null)
touch "$SEEN" "$WORK"; newseen=$(mktemp); newwork=$(mktemp)

while IFS=$'\x1f' read -r id name state pid cwd fg; do
  [ -z "$id" ] && continue
  if grep -qF -e "$id" -e "\"$name\"" <<<"$attention"; then
    grep "^$id " "$SEEN" >> "$newseen"; grep "^$id " "$WORK" >> "$newwork"; continue   # blocked on a human
  fi
  reason=""
  cmd=$(ps -o comm= -p "$pid" 2>/dev/null)
  if [ "$state" = none ] && case "${cmd##*/}" in -zsh|zsh|-bash|bash|sh) true ;; *) false ;; esac && ! pgrep -P "$pid" >/dev/null; then
    reason="no agent"
  fi
  screen=$(tuios capture-pane -s "$SESSION" -w "$id" 2>/dev/null)
  if [ -z "$reason" ] && [ "$state" != working ] && [ "${fg##*/}" = claude ] \
     && [[ "$(agent_last_line "$cwd" "$pid")" =~ ^[[:space:]]*STATUS:\ done ]]; then reason="STATUS: done (transcript)"; fi
  h=$(md5 -q -s "$screen"); first=$(grep "^$id $h " "$SEEN" | cut -d' ' -f3)
  [ -z "$first" ] && first=$now
  if [ -z "$reason" ] && [ "$state" != working ] && [ $((now-first)) -ge $IDLE ]; then reason="screen unchanged $(( (now-first)/60 )) min"; fi
  if [ "$state" = working ]; then
    wfirst=$(grep "^$id " "$WORK" | cut -d' ' -f2); [ -z "$wfirst" ] && wfirst=$now
    if [ -z "$reason" ] && [ $((now-wfirst)) -ge $CAP ] && ! grep -qxF "$name" "$KEEP" 2>/dev/null; then
      reason="working $(( (now-wfirst)/60 )) min, over cap"
    fi
  fi
  if [ -n "$reason" ]; then
    say "$name" "$reason"
    [ $DRY = 1 ] && echo "$id $h $first" >> "$newseen"
    [ $DRY = 0 ] && { mkdir -p "$STATE/closed"; printf '%s\n' "$screen" > "$STATE/closed/$(date +%F-%H%M)-$name.txt"; tuios close-window "$id" -s "$SESSION" >/dev/null 2>&1; }
  else
    echo "$id $h $first" >> "$newseen"
    [ "$state" = working ] && echo "$id $wfirst" >> "$newwork"
  fi
done < <(jq -r '.windows[] | [.window_id, .display_name, (.agent_state // "none"), .pid, (.cwd // ""), (.foreground_cmd // "")] | map(tostring) | join("\u001f")' <<<"$windows")
mv "$newseen" "$SEEN"; mv "$newwork" "$WORK"

LABEL=${CLAUDE_PLUGIN_OPTION_HERDR_TAB_LABEL:-}
if [ -n "$LABEL" ] && command -v herdr >/dev/null 2>&1 && [ "$(tuios list-windows -s "$SESSION" --json 2>/dev/null | jq '.windows|length')" = 0 ]; then
  tab=$(herdr tab list 2>/dev/null | jq -r --arg l "$LABEL" '.result.tabs[]? | select(.label==$l) | .tab_id' | head -1)
  if [ -n "$tab" ]; then
    if [ $DRY = 1 ]; then echo "$(date '+%F %T') would close herdr tab $LABEL $tab" >> "$LOG"; echo "multi-agent-kit reaper: would close herdr tab $LABEL"
    else herdr tab close "$tab" >/dev/null 2>&1 && echo "$(date '+%F %T') closed herdr tab $LABEL $tab" >> "$LOG"; fi
  fi
fi
exit 0
