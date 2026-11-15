#!/usr/bin/env bash
# Runs the fork-cleanup hook against a fake `gh` on PATH and a temporary HOME.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOK="$ROOT/plugins/fork-cleanup/hooks/fork_cleanup.sh"
T="$(mktemp -d "${TMPDIR:-/tmp}/fork-cleanup-test.XXXXXX")"; T="$(cd "$T" && pwd -P)"
mkdir -p "$T/bin" "$T/home"
CALLS="$T/calls"
FAILS=0
ok()   { echo "PASS: $*"; }
bad()  { echo "FAIL: $*"; FAILS=$((FAILS+1)); }

NOW=$(date +%s); OLD=$((NOW - 200*86400)); YOUNG=$((NOW - 10*86400))
cat > "$T/bin/gh" <<FAKE
#!/usr/bin/env bash
echo "\$*" >> "$CALLS"
case "\$1 \$2" in
  "api user") echo me ;;
  "repo list") printf 'me/old-clean|$OLD\nme/young|$YOUNG\nme/kept|$OLD\nme/own-commits|$OLD\nme/orphan|$OLD\nme/branchy|$OLD\n' ;;
  "repo delete") ;;
  "api repos/"*)
    case "\$2" in
      */branches) case "\$2" in *branchy*) echo 2 ;; *) echo 1 ;; esac ;;
      */compare/*) case "\$2" in *own-commits*) echo 3 ;; *) echo 0 ;; esac ;;
      *) n="\${2#repos/me/}"; case "\$n" in orphan) echo '||main' ;; *) printf 'up/%s|main|main\n' "\$n" ;; esac ;;
    esac ;;
esac
FAKE
chmod +x "$T/bin/gh"

run() { # run <account> <delete> [keep]
  : > "$CALLS"; rm -rf "$T/data"
  PATH="$T/bin:$PATH" HOME="$T/home" CLAUDE_PLUGIN_DATA="$T/data" \
  CLAUDE_PLUGIN_OPTION_GITHUB_ACCOUNT="$1" CLAUDE_PLUGIN_OPTION_DELETE_FORKS="$2" \
  CLAUDE_PLUGIN_OPTION_MIN_AGE_DAYS=90 CLAUDE_PLUGIN_OPTION_KEEP="${3:-}" \
  bash "$HOOK" >/dev/null
}
# The fake must be the gh on PATH, or the test could reach the real GitHub.
[ "$(PATH="$T/bin:$PATH" command -v gh)" = "$T/bin/gh" ] || { echo "FAIL: fake gh is not first on PATH"; exit 1; }

run me false me/kept
grep -q 'repo delete' "$CALLS" && bad "dry-run made a delete call" || ok "dry-run makes no delete call"
grep -q 'would delete me/old-clean' "$T/data/fork-cleanup.log" && ok "dry-run logs what it would delete" || bad "dry-run log missing"

run me true me/kept
[ "$(grep -c 'repo delete' "$CALLS")" = 1 ] && grep -q 'repo delete me/old-clean --yes' "$CALLS" && ok "switched on, deletes only the fork meeting every condition" || bad "wrong deletes: $(grep 'repo delete' "$CALLS")"
grep -q 'repo delete me/\(kept\|young\|own-commits\|orphan\|branchy\)' "$CALLS" && bad "deleted a protected fork" || ok "keep-list, young, own-commit, parentless and multi-branch forks are never deleted"
grep -q 'deleted me/old-clean' "$T/data/fork-cleanup.log" && ok "delete is logged" || bad "delete not logged"

run other true
grep -q 'repo ' "$CALLS" && bad "acted on an account that is not the signed-in user" || ok "account differing from signed-in user: no repo call"

run "" true
[ ! -s "$CALLS" ] && ok "no account set: no gh call" || bad "gh was called with no account: $(cat "$CALLS")"
[ ! -e "$T/data" ] && ok "no account set: nothing written" || bad "wrote data with no account"

echo "---"; [ "$FAILS" = 0 ] && echo "all passed" || echo "$FAILS failed"
[ "$FAILS" = 0 ]
