#!/usr/bin/env bash
# Run from anywhere: bash tests/core/test_guards.sh
# Runs the three core guard hooks against a temporary HOME and a temporary git repo.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
H="$ROOT/plugins/core/hooks"
T="$(mktemp -d "${TMPDIR:-/tmp}/moka-guards.XXXXXX")"; T="$(cd "$T" && pwd -P)"
export HOME="$T/home" CLAUDE_PLUGIN_DATA="$T/data"
mkdir -p "$HOME"
fail=0
check() { if "${@:2}"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }
logged() { grep -q -- "$2" "$CLAUDE_PLUGIN_DATA/$1" 2>/dev/null; }

# ---- delete guard ----
mkdir -p "$HOME/keep/sub" "$HOME/other"
guard() { # guard <command> -> exit code, with the plugin options in the environment
  printf '{"tool_input":{"command":%s},"cwd":"%s"}' "$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$1")" "$HOME" |
    python3 "$H/delete_guard.py" >/dev/null 2>&1
}
export CLAUDE_PLUGIN_OPTION_PROTECTED_PATHS="$HOME/keep"
guard "rm -rf $HOME/keep/sub"; check "guard dry-run (default) allows" test $? -eq 0
check "guard dry-run logs would block" logged delete-guard.log "would block"
export CLAUDE_PLUGIN_OPTION_DELETE_GUARD_DRY_RUN=false
guard "rm -rf $HOME/keep/sub"; check "guard blocks rm in a protected path" test $? -eq 2
guard "rm -rf $HOME/other";    check "guard allows rm outside it" test $? -eq 0
guard "rm -rf $HOME";          check "guard blocks a parent of a protected path" test $? -eq 2
guard "find $HOME/keep -delete"; check "guard blocks find -delete" test $? -eq 2
guard "cd $HOME/keep && rm -rf sub"; check "guard follows cd" test $? -eq 2
guard "bash -c 'rm -rf $HOME/keep/sub'"; check "guard looks inside bash -c" test $? -eq 2
guard "python3 -c 'import shutil; shutil.rmtree(\"$HOME/keep\")'"; check "guard blocks rmtree" test $? -eq 2
guard "echo hi
rm -rf $HOME/keep/sub"; check "guard sees a delete after a newline" test $? -eq 2
guard "bash -lc 'rm -rf $HOME/keep/sub'"; check "guard looks inside bash -lc" test $? -eq 2
guard "(rm -rf $HOME/keep/sub)"; check "guard sees a delete in a subshell" test $? -eq 2
guard "git clean -nfd $HOME/keep"; check "guard allows git clean -n" test $? -eq 0
guard "ls $HOME/keep";         check "guard allows a non-delete" test $? -eq 0
check "guard logs the block" logged delete-guard.log "blocked:"
check "guard never deleted anything" test -d "$HOME/keep/sub"
export CLAUDE_PLUGIN_OPTION_PROTECTED_PATHS=""
guard "rm -rf $HOME/keep/sub"; check "guard with no paths does nothing" test $? -eq 0
unset CLAUDE_PLUGIN_OPTION_PROTECTED_PATHS CLAUDE_PLUGIN_OPTION_DELETE_GUARD_DRY_RUN

# ---- worktree sweep ----
git init -q --bare "$T/origin.git"
git clone -q "$T/origin.git" "$T/repo" 2>/dev/null
cd "$T/repo" || exit 1
git config user.email t@localhost; git config user.name t
git checkout -q -b main; echo a > f; git add f; git commit -q -m init; git push -q -u origin main 2>/dev/null
git remote set-head origin main >/dev/null 2>&1
mkdir -p "$T/wt" "$T/outside"
git worktree add -q -b merged "$T/wt/merged"
git worktree add -q -b dirty "$T/wt/dirty"; echo x > "$T/wt/dirty/new"
git worktree add -q -b unmerged "$T/wt/unmerged"; (cd "$T/wt/unmerged" && echo u > u && git add u && git commit -q -m u)
git worktree add -q -b ignored "$T/wt/ignored"; echo '*.dat' > "$T/wt/ignored/.gitignore"; (cd "$T/wt/ignored" && git add .gitignore && git commit -q -m ig && echo s > local.dat)
git merge -q ignored; git push -q origin main 2>/dev/null
git worktree add -q -b offroot "$T/outside/offroot"
sweep() { printf '{"cwd":"%s"}' "$T/repo" | bash "$H/worktree_sweep.sh" >/dev/null 2>&1; }
gone() { [ ! -d "$1" ]; }
export CLAUDE_PLUGIN_OPTION_WORKTREE_SWEEP_ROOTS="$T/wt"
sweep
check "sweep dry-run (default) removes nothing" test -d "$T/wt/merged" -a -d "$T/wt/dirty"
check "sweep dry-run logs would remove" logged worktree-sweep.log "would remove $T/wt/merged"
export CLAUDE_PLUGIN_OPTION_WORKTREE_SWEEP_DRY_RUN=false
export CLAUDE_PLUGIN_OPTION_WORKTREE_SWEEP_ROOTS=""
sweep
check "sweep with no roots does nothing" test -d "$T/wt/merged"
export CLAUDE_PLUGIN_OPTION_WORKTREE_SWEEP_ROOTS="$T/wt"
sweep
check "sweep removes the merged clean worktree" gone "$T/wt/merged"
check "sweep deletes its branch" bash -c "! git -C '$T/repo' rev-parse --verify -q merged >/dev/null"
check "sweep keeps uncommitted work" test -d "$T/wt/dirty"
check "sweep keeps ignored files" test -f "$T/wt/ignored/local.dat"
check "sweep keeps unmerged work" test -d "$T/wt/unmerged"
check "sweep ignores worktrees outside the roots" test -d "$T/outside/offroot"
check "sweep logs the removal" logged worktree-sweep.log "removed $T/wt/merged"
check "sweep never touches the main checkout" test -d "$T/repo/.git"
cd "$T" || exit 1
unset CLAUDE_PLUGIN_OPTION_WORKTREE_SWEEP_ROOTS CLAUDE_PLUGIN_OPTION_WORKTREE_SWEEP_DRY_RUN

# ---- stale-agent reaper ----
sleep 98761 & hit=$!; sleep 98762 & decoy=$!
sleep 3
alive() { kill -0 "$1" 2>/dev/null; }
reap() { bash "$H/stale_agent_reaper.sh" >/dev/null 2>&1; }
export CLAUDE_PLUGIN_OPTION_REAPER_MAX_AGE_HOURS=0.0005
export CLAUDE_PLUGIN_OPTION_REAPER_MATCH="sleep 98761"
reap
check "reaper dry-run (default) stops nothing" alive $hit
check "reaper dry-run logs would stop" logged stale-agent-reaper.log "would stop $hit"
export CLAUDE_PLUGIN_OPTION_REAPER_DRY_RUN=false
export CLAUDE_PLUGIN_OPTION_REAPER_MATCH=""
reap
check "reaper with no match does nothing" alive $hit
export CLAUDE_PLUGIN_OPTION_REAPER_MAX_AGE_HOURS=1
export CLAUDE_PLUGIN_OPTION_REAPER_MATCH="sleep 98761"
reap
check "reaper spares a process younger than the age" alive $hit
export CLAUDE_PLUGIN_OPTION_REAPER_MAX_AGE_HOURS=0.0005
reap; sleep 1
check "reaper stops the matched old process" bash -c "! kill -0 $hit 2>/dev/null"
check "reaper spares a process outside the match" alive $decoy
check "reaper logs the stop" logged stale-agent-reaper.log "stopped $hit"
kill $decoy 2>/dev/null; wait 2>/dev/null

exit $fail
