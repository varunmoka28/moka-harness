#!/usr/bin/env bash
# Usage: published_files.sh <repo>
# Prints, NUL-separated, the tracked files of <repo> that go public: everything under the
# published paths except docs/specs/, docs/plans/ and docs/sources/.
set -u
cd "$1" || exit 1
git ls-files -z -- .claude-plugin plugins scripts tests marketplace.d README.md CREDITS.md \
    CHANGELOG.md LICENSE .github docs \
  | python3 -c '
import sys
for f in sys.stdin.buffer.read().split(b"\0"):
    if f and not f.startswith((b"docs/specs/", b"docs/plans/", b"docs/sources/")):
        sys.stdout.buffer.write(f + b"\0")'
