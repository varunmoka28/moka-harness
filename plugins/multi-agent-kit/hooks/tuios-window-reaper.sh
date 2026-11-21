#!/bin/bash
# SessionStart + Stop: close tuios windows, in the one tuios session the user named, that are empty or have run away.
#   1. no agent in it: a bare shell with no child process
#   2. agent in "working" state for over 2 hours (a runaway), unless the window's name is listed in
#      ${CLAUDE_PLUGIN_DATA}/reaper.keep (one name per line)
# It does not close a window for finishing or for sitting idle: close a worker yourself once you have accepted its
# result. tuios-status-hook.sh flags finished and idle windows.
# Never touches a window listed in `tuios list-attention` (approval, question, plan, error).
# The last screen of each closed window goes to ${CLAUDE_PLUGIN_DATA}/closed/.
# When no windows remain and herdr_tab_label is set, closes the herdr tab with that label.
# --done-line <cwd> <pid>: needs no session, daemon or plugin data, prints nothing, and exits 0 only when the agent's
# own last message in its transcript ends with a line "STATUS: done", else 1. Read from the transcript, never from
# the screen: the screen also shows what was typed into it, and a typed "end with STATUS: done." could read as done.
# tuios-status-hook.sh calls it. Windows without a transcript (agy, Codex) are never done.
#
# It closes things, so: it does nothing until tuios_session names a session; it only reports
# ("would close") until reaper_dry_run is switched off; every action goes to
# ${CLAUDE_PLUGIN_DATA}/reaper.log. Needs tuios and jq; with either missing it does nothing.
# macOS: uses md5 and stat -f.
# REAPER_SOCK and REAPER_PROJECTS override the daemon socket and the transcript folder (used by tests/multi-agent-kit/test_hooks.sh).
set -u
now=$(date +%s)
PROJECTS=${REAPER_PROJECTS:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects}
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
[ "${1:-}" = --done-line ] && { [[ "$(agent_last_line "${2:-}" "${3:-}")" =~ ^[[:space:]]*STATUS:\ done ]]; exit; }   # before the guards below: their exit 0 would read as "done"
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
CAP=7200
SOCK=${REAPER_SOCK:-/tmp/tuios-$(id -u)/servers/$SESSION/tuios.sock}
LOG=$STATE/reaper.log
SEEN=$STATE/reaper.seen   # "<window_id> <screen md5> <first-seen epoch>"
WORK=$STATE/reaper.work   # "<window_id> <first-seen-working epoch>"
KEEP=$STATE/reaper.keep   # window names exempt from the working cap
mkdir -p "$STATE"

[ -S "$SOCK" ] || exit 0   # no daemon: do not start one
say() { # $1 what, $2 reason
  local verb="closed"; [ $DRY = 1 ] && verb="would close"
  echo "$(date '+%F %T') $verb $1 ($2)" >> "$LOG"
  [ $DRY = 1 ] && echo "multi-agent-kit reaper: would close $1 ($2)"
}

windows=$(tuios list-windows -s "$SESSION" --json 2>/dev/null) || exit 0
attention=$(tuios list-attention -s "$SESSION" --kind approval,plan,ask,question,errored --json 2>/dev/null | jq -c '.items[]?' 2>/dev/null)
touch "$SEEN" "$WORK"; newseen=$(mktemp); newwork=$(mktemp)

while IFS=$'\x1f' read -r id name state pid; do
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
  h=$(md5 -q -s "$screen"); first=$(grep "^$id $h " "$SEEN" | cut -d' ' -f3)
  [ -z "$first" ] && first=$now
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
done < <(jq -r '.windows[] | [.window_id, .display_name, (.agent_state // "none"), .pid] | map(tostring) | join("\u001f")' <<<"$windows")
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
