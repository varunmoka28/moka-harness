#!/usr/bin/env bash
# Usage: export_public.sh [--no-private] <target-folder>
# Copies the tracked, published files into an empty target, then leak-scans the target.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCAN_ARGS=()
TARGET=""
for a in "$@"; do
  case "$a" in --no-private) SCAN_ARGS+=(--no-private) ;; *) TARGET="$a" ;; esac
done
[ -n "$TARGET" ] || { echo "usage: $0 [--no-private] <target-folder>" >&2; exit 2; }
if [ -e "$TARGET" ]; then
  [ -d "$TARGET" ] && [ -z "$(ls -A "$TARGET")" ] || { echo "export_public: target exists and is not empty: $TARGET" >&2; exit 1; }
fi
mkdir -p "$TARGET" || exit 1
TARGET="$(cd "$TARGET" && pwd)"

cd "$HERE" || exit 1
bash "$HERE/scripts/published_files.sh" "$HERE" \
  | tar -cf - --null -T - | tar -xf - -C "$TARGET" || { echo "export_public: copy failed" >&2; exit 1; }

cd "$TARGET" || exit 1
git init -q && git add -A || exit 1
bash "$HERE/scripts/leak_scan.sh" ${SCAN_ARGS[@]+"${SCAN_ARGS[@]}"} "$TARGET"
rc=$?
[ "$rc" -eq 0 ] || { echo "export_public: leak scan failed (exit $rc) on $TARGET" >&2; exit 1; }
