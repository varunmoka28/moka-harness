#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
B="$REPO_ROOT/scripts/build_marketplace.py"
out() { echo "$1/.claude-plugin/marketplace.json"; }

r="$(make_root)"
expect_rc 1 "--check fails when file is missing" python3 "$B" --root "$r" --check
expect_rc 0 "build writes the file" python3 "$B" --root "$r"
python3 - "$(out "$r")" <<'PY' || fail "output content"
import json, sys
m = json.load(open(sys.argv[1]))
assert m["name"] == "moka-harness" and m["owner"]["name"], m
assert [p["name"] for p in m["plugins"]] == ["own", "ext"]
PY
pass "output has name, owner, entries in order"
expect_rc 0 "--check passes when current" python3 "$B" --root "$r" --check
echo "{}" > "$(out "$r")"
expect_rc 1 "--check fails when file differs" python3 "$B" --root "$r" --check

r="$(make_root)"
echo "[{\"name\":\"own\",\"source\":\"./plugins/own\"}]" > "$r/marketplace.d/b.json"
expect_rc 1 "duplicate name fails" python3 "$B" --root "$r"
case "$OUT" in *own*) pass "duplicate error names the entry";; *) fail "no name in: $OUT";; esac

r="$(make_root)"
sed -i.bak "s/\"sha\":\"$SHA_A\"/\"sha\":\"abc123\"/" "$r/marketplace.d/a.json"
expect_rc 1 "short sha fails" python3 "$B" --root "$r"

r="$(make_root)"
sed -i.bak "s/\"sha\":\"$SHA_A\"//; s/\"repo\":\"someone\/ext\",/\"repo\":\"someone\/ext\"/" "$r/marketplace.d/a.json"
expect_rc 1 "missing sha fails" python3 "$B" --root "$r"

r="$(make_root)"
mkdir -p "$r/gone" && rmdir "$r/plugins/own"
expect_rc 1 "missing local folder fails" python3 "$B" --root "$r"

r="$(make_root)"
