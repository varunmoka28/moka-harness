#!/usr/bin/env bash
# SessionStart(startup): stop processes that have run longer than reaper_max_age_hours
# and whose command line contains one of the strings in reaper_match (one per line, or
# ":"-separated). Age is time since the process started, not CPU idleness.
# With no match set it does nothing; it never signals a process outside the match, nor
# this session's own ancestors. Dry-run is the default: it logs "would stop" and kills
# nothing until reaper_dry_run is switched off. Every action goes to ${CLAUDE_PLUGIN_DATA}/stale-agent-reaper.log.
set -u

MATCH=$(printf '%s' "${CLAUDE_PLUGIN_OPTION_REAPER_MATCH:-}" | tr ':' '\n' | sed '/^[[:space:]]*$/d')
[ -z "$MATCH" ] && exit 0
LOGDIR=${CLAUDE_PLUGIN_DATA:-}
[ -z "$LOGDIR" ] && { echo "stale-agent-reaper: CLAUDE_PLUGIN_DATA not set, no log possible, doing nothing"; exit 0; }
mkdir -p "$LOGDIR"; LOG="$LOGDIR/stale-agent-reaper.log"
case "$(printf '%s' "${CLAUDE_PLUGIN_OPTION_REAPER_DRY_RUN:-true}" | tr 'A-Z' 'a-z')" in
  false|0|no|off) DRY=0 ;; *) DRY=1 ;;
esac
MAX=$(awk -v h="${CLAUDE_PLUGIN_OPTION_REAPER_MAX_AGE_HOURS:-24}" 'BEGIN{ if (h+0 > 0) printf "%d", h*3600; else print 86400 }')

secs() { # ps etime [[dd-]hh:]mm:ss -> seconds
  local t=$1 d=0 h=0 m s a b c
  case $t in *-*) d=${t%%-*}; t=${t#*-} ;; esac
  IFS=: read -r a b c <<<"$t"
  if [ -n "$c" ]; then h=$a; m=$b; s=$c; else m=$a; s=$b; fi
  echo $(( 10#$d*86400 + 10#$h*3600 + 10#$m*60 + 10#$s ))
}

# This process and its ancestors (the session itself) are never stopped.
mine=" "; p=$$
while [ "$p" -gt 1 ]; do mine="$mine$p "; p=$(ps -o ppid= -p "$p" | tr -d ' '); [ -z "$p" ] && break; done

ps -axo pid=,etime=,command= | while read -r pid et cmd; do
  hit=""
  while IFS= read -r m; do case "$cmd" in *"$m"*) hit=$m; break ;; esac; done <<<"$MATCH"
  [ -z "$hit" ] && continue
  case "$mine" in *" $pid "*) continue ;; esac
  [ "$(secs "$et")" -lt "$MAX" ] && continue
  if [ $DRY = 1 ]; then
    echo "$(date '+%F %T') would stop $pid ($et) ${cmd:0:100}" >> "$LOG"
    echo "stale-agent-reaper: would stop $pid ($et) ${cmd:0:80}"
    continue
  fi
  kill "$pid" 2>/dev/null && echo "$(date '+%F %T') stopped $pid ($et) ${cmd:0:100}" >> "$LOG"
done
exit 0
