#!/usr/bin/env bash
# Runs every test in tests/scripts. No network, no Claude install.
cd "$(dirname "$0")" || exit 1
rc=0
for t in test_*.sh; do
  echo "== $t"
  bash "$t" || rc=1
done
[ "$rc" -eq 0 ] && echo "ALL PASSED" || echo "FAILURES"
exit $rc
