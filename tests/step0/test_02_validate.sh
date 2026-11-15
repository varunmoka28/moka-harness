#!/usr/bin/env bash
# Record what `claude plugin validate` says about pinned third-party entries.
source "$(dirname "$0")/lib.sh"
report="$REPO_ROOT/tests/step0/validate-report.txt"

set +e
out="$(claude plugin validate "$FIXTURE" 2>&1)"
code=$?
set -e
# The validator prints absolute paths; keep the home path out of the committed report.
printf '%s\n' "${out//"$REPO_ROOT"/<repo>}" >"$report"
echo "exit code: $code" >>"$report"

# Any message that names an entry's source (plugins.1.source or plugins[1].source)
# means a pinned source object was refused.
grep -Eq 'plugins(\.|\[)[0-9]+\]?\.source' "$report" \
  && fail "the validator rejects a pinned source object; see $report"

if grep -q 'Plugin name "claude-mem" is reserved' "$report"; then
  pass "validator flags the name claude-mem as reserved (expected); exit code $code"
else
  pass "validator does not flag the name claude-mem; exit code $code"
fi
pass "pinned github and git-subdir sources are accepted by the validator"
