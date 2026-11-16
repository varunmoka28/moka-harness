#!/bin/bash
# claude-hud status line, redrawn as colored segments by statusline.py.
cols=${COLUMNS:-}
case "$cols" in ""|*[!0-9]*) cols=$(stty size 2>/dev/null </dev/tty | awk '{print $2}');; esac
case "$cols" in ""|*[!0-9]*) cols=120;; esac
export COLUMNS=$(( cols > 4 ? cols - 4 : 1 ))
plugin_dir=$(ls -d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/{claude-hud,hud}/*/ 2>/dev/null \
  | awk -F/ '{ print $(NF-1) "\t" $(0) }' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+[[:space:]]' \
  | sort -t. -k1,1n -k2,2n -k3,3n -k4,4n | tail -1 | cut -f2-)
input=$(cat)
export STATUS_CWD=$(printf %s "$input" | python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("workspace") or {}).get("current_dir") or d.get("cwd") or "")')
printf %s "$input" | COLUMNS=1000 bun --env-file /dev/null "${plugin_dir}src/index.ts" | python3 "$(dirname "$0")/statusline.py" "$COLUMNS"
