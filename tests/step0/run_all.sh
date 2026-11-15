#!/usr/bin/env bash
# Run every step 0 test and print one line per test. Exits 1 if any failed.
cd "$(dirname "$0")"
status=0
for t in test_0*.sh; do
  if bash "$t" >"/tmp/${t%.sh}.log" 2>&1; then
    echo "ok    $t"
  else
    echo "FAIL  $t   (log: /tmp/${t%.sh}.log)"
    status=1
  fi
done
exit $status
