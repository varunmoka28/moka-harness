#!/bin/bash
# Send a prompt to a Claude window in tuios and make sure it was submitted.
# Usage: tuios-send-verified.sh send  <window> <text>   type the text, press Enter, wait until the box is empty
#        tuios-send-verified.sh enter <window>          press Enter only if the box holds unsent text and no menu is up
#        tuios-send-verified.sh check <window>          print the box state, change nothing
# States: empty | ghost: <text> | unsent: <text> | menu
#   ghost  = the next-steps-autopilot mod's dim Tab-to-take suggestion. It is not typed text: Enter does nothing
#            to it and the agent is idle on purpose. Treated as empty. (2026-10-22: read as "unsent" all night.)
#   menu   = a question is up (stale-file guard, scope guard, trust screen). This script never answers a menu.
# Exit 0: submitted / box empty or ghost.  Exit 1: text still in the box after retries.  Exit 2: menu.
# Needs TUIOS_SESSION (or the plugin option tuios_session): the tuios session the window is in.
set -u
S=${TUIOS_SESSION:-${CLAUDE_PLUGIN_OPTION_TUIOS_SESSION:-}}
[ -n "$S" ] || { echo "set TUIOS_SESSION to your tuios session name" >&2; exit 64; }
export TUIOS_SERVER=$S
MODE=$1; W=$2; TEXT=${3:-}
TRIES=${SEND_TRIES:-4}; PAUSE=${SEND_PAUSE:-3}
ESC=$(printf '\033')

pane() { tuios capture-pane -s "$S" -w "$W" 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g'; }
# The prompt box is the LAST line that starts with ❯; earlier ❯ lines are submitted history.
# --ansi keeps the styles: ghost text is drawn dim (SGR 2) or grey (SGR 90 / 38;5;24x), typed text is not.
box_raw() { tuios capture-pane --ansi -s "$S" -w "$W" 2>/dev/null | grep -a '❯' | tail -1; }
box() { box_raw | sed 's/\x1b\[[0-9;]*m//g; s/^❯[[:space:]]*//; s/[[:space:]]*$//'; }
is_ghost() { box_raw | sed 's/^[^❯]*❯//' | grep -qE "${ESC}\[(2|90|38;5;2[3-5][0-9])(;[0-9]+)*m"; }
menu_up() { pane | grep -qE 'Enter to select|^❯ [0-9]+\. |Edit it anyway\?|Restate the goal|Yes, I trust'; }

state() {
  if menu_up; then echo menu
  elif [ -z "$(box)" ]; then echo empty
  elif is_ghost; then echo "ghost: $(box)"
  else echo "unsent: $(box)"; fi
}

case $MODE in
  check) state; exit 0 ;;
  send)
    [ -n "$TEXT" ] || { echo "send needs text" >&2; exit 64; }
    if menu_up; then echo "$W: a question menu is up, not sending"; exit 2; fi
    tuios send-text -s "$S" -w "$W" "$TEXT"
    sleep 1 ;;
  enter) ;;
  *) echo "mode must be send, enter or check" >&2; exit 64 ;;
esac

for _ in $(seq "$TRIES"); do
  s=$(state)
  case $s in
    empty)  echo "$W: submitted, box empty"; exit 0 ;;
    ghost*) echo "$W: box holds only a ghost suggestion, nothing to submit ($s)"; exit 0 ;;
    menu)   echo "$W: a question menu is up, Enter not sent"; pane | grep -v '^[[:space:]]*$' | tail -8; exit 2 ;;
    *)      tuios send-keys -s "$S" -w "$W" Enter; sleep "$PAUSE" ;;
  esac
done
echo "$W: STILL UNSENT after $TRIES tries: $(box). If Enter changes nothing it is probably a ghost the style check missed; do not ctrl+u and resend."
exit 1
