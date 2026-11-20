#!/usr/bin/env bash
# Usage: sync_public.sh [--no-private] <public-repo>
# Copies the tracked, published files of this repo over an existing public clone, then
# leak-scans it. Refuses a public clone with uncommitted changes. Files tracked in the
# public clone but not published here are listed, never deleted. Commits nothing.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCAN_ARGS=()
TARGET=""
for a in "$@"; do
  case "$a" in --no-private) SCAN_ARGS+=(--no-private) ;; *) TARGET="$a" ;; esac
done
[ -n "$TARGET" ] || { echo "usage: $0 [--no-private] <public-repo>" >&2; exit 2; }
git -C "$TARGET" rev-parse --git-dir >/dev/null 2>&1 || { echo "sync_public: not a git repo: $TARGET" >&2; exit 1; }
TARGET="$(cd "$TARGET" && pwd)"
[ "$TARGET" != "$HERE" ] || { echo "sync_public: target is this repo" >&2; exit 1; }
[ -z "$(git -C "$TARGET" status --porcelain)" ] || { echo "sync_public: $TARGET has uncommitted changes; commit or stash them first" >&2; exit 1; }

bash "$HERE/scripts/published_files.sh" "$HERE" \
  | tar -C "$HERE" -cf - --null -T - | tar -xf - -C "$TARGET" || { echo "sync_public: copy failed" >&2; exit 1; }

extra="$(comm -23 <(git -C "$TARGET" ls-files | sort) \
  <(bash "$HERE/scripts/published_files.sh" "$HERE" | tr '\0' '\n' | sort) | grep -v -x '.gitignore' || true)"
[ -z "$extra" ] || { echo "sync_public: tracked in the public repo but not published here (left alone):"; echo "$extra" | sed 's/^/  /'; }

bash "$HERE/scripts/leak_scan.sh" ${SCAN_ARGS[@]+"${SCAN_ARGS[@]}"} "$TARGET"
rc=$?
[ "$rc" -eq 0 ] || { echo "sync_public: leak scan failed (exit $rc) on $TARGET; nothing committed" >&2; exit 1; }
echo "sync_public: changes in $TARGET:"
git -C "$TARGET" status --short
