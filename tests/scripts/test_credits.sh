#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
r="$(make_repo)"
expect_rc 0 "credits writes" python3 "$REPO_ROOT/scripts/credits.py" --root "$r" --date 2026-01-02
python3 - "$r/CREDITS.md" "$SHA_A" <<'PY' || fail "content"
import sys
t = open(sys.argv[1]).read()
row = [l for l in t.splitlines() if l.startswith("| ext")]
assert len(row) == 1, t
for want in ("Someone", "https://github.com/someone/ext", "MIT", sys.argv[2], "2026-01-02"):
    assert want in row[0], (want, row[0])
assert "| own" not in t
PY
pass "row has author, link, licence, pin, date; local entry left out"
