#!/usr/bin/env bash
# Leak scan: generic patterns (scripts/leak_patterns.txt) plus private terms read from a
# file outside the repo. Usage: leak_scan.sh [--no-private] [dir]
# Exit 0 clean, 1 hit, 2 setup error. Private terms are never printed (CI logs are public).
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATTERNS="$SCRIPT_DIR/leak_patterns.txt"
ALLOW="$SCRIPT_DIR/leak_allow.txt"
DENYLIST="${MOKA_HARNESS_DENYLIST:-$HOME/.config/moka-harness/denylist.txt}"

NO_PRIVATE=0
DIR=""
for a in "$@"; do
  case "$a" in
    --no-private) NO_PRIVATE=1 ;;
    *) DIR="$a" ;;
  esac
done
[ -z "$DIR" ] && DIR="$SCRIPT_DIR/.."

die() { echo "leak_scan: $*" >&2; exit 2; }

[ -d "$DIR" ] || die "not a directory: $DIR"
[ -r "$PATTERNS" ] || die "missing patterns file: $PATTERNS"
cd "$DIR" || die "cannot enter $DIR"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not a git repo: $DIR"

if [ "$NO_PRIVATE" -eq 1 ]; then
  echo "leak_scan: warning: --no-private set, private terms not checked" >&2
elif [ ! -r "$DENYLIST" ]; then
  die "private denylist missing: $DENYLIST (set MOKA_HARNESS_DENYLIST or pass --no-private)"
fi

# Tracked, non-allowed, text files.
globs=()
if [ -r "$ALLOW" ]; then
  while IFS= read -r g || [ -n "$g" ]; do
    g="${g%$'\r'}"
    case "$g" in ''|'#'*) continue ;; esac
    globs+=("$g")
  done < "$ALLOW"
fi

files=()
while IFS= read -r -d '' f; do
  [ -f "$f" ] || continue
  skip=0
  for g in ${globs[@]+"${globs[@]}"}; do
    # shellcheck disable=SC2254
    case "$f" in $g) skip=1; break ;; esac
  done
  [ "$skip" -eq 1 ] && continue
  grep -qI . "$f" 2>/dev/null || [ ! -s "$f" ] || continue   # binary: grep -I finds no text
  files+=("$f")
done < <(git ls-files -z)

hits=0
report() { echo "$1:$2: $3"; hits=$((hits + 1)); }

# Generic patterns.
while IFS=$'\t' read -r name regex || [ -n "$name" ]; do
  case "$name" in ''|'#'*) continue ;; esac
  regex="${regex%$'\r'}"
  [ -n "$regex" ] || continue
  for f in ${files[@]+"${files[@]}"}; do
    while IFS= read -r n; do
      [ -n "$n" ] && report "$f" "$n" "$name"
    done < <(grep -InE -e "$regex" -- "$f" 2>/dev/null | cut -d: -f1)
  done
done < "$PATTERNS"

# Private terms: report the denylist line number, never the term.
if [ "$NO_PRIVATE" -eq 0 ]; then
  ln=0
  while IFS= read -r term || [ -n "$term" ]; do
    ln=$((ln + 1))
    term="${term%$'\r'}"
    case "$term" in ''|'#'*) continue ;; esac
    for f in ${files[@]+"${files[@]}"}; do
      while IFS= read -r n; do
        [ -n "$n" ] && report "$f" "$n" "private term #$ln"
      done < <(grep -InFi -e "$term" -- "$f" 2>/dev/null | cut -d: -f1)
    done
  done < "$DENYLIST"
fi

# gitleaks, when installed.
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks detect --no-git --source . --redact >&2 || hits=$((hits + 1))
else
  echo "leak_scan: warning: gitleaks not installed, skipped" >&2
fi

[ "$hits" -eq 0 ] && exit 0
exit 1
