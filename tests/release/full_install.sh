#!/usr/bin/env bash
# Release gate: install core and every bundle from this repo's marketplace in a sandbox,
# check each member is recorded (third-party ones at their pin), then remove the
# marketplace and list what is left. Slow: it clones every third-party repo.
source "$(dirname "$0")/../step0/lib.sh"
before=$(real_fingerprint); sandbox_up
claude plugin marketplace add "$REPO_ROOT" >/dev/null || fail "could not add the marketplace"
for b in core core-bundle writing design media research multi-agent jev; do
  claude plugin install "$b@moka-harness" >/dev/null 2>&1 && echo "installed $b" || echo "FAIL install $b"
done
python3 - "$REPO_ROOT" "$SANDBOX/plugins/installed_plugins.json" <<'PY'
import json, sys
root, rec = sys.argv[1:3]
market = {p["name"]: p for p in json.load(open(root + "/.claude-plugin/marketplace.json"))["plugins"]}
installed = json.load(open(rec)).get("plugins", {})
bundles = ["core-bundle", "writing", "design", "media", "research", "multi-agent", "jev"]
want = {"core"} | set(bundles)
for b in bundles:
    want |= set(json.load(open(f"{root}/plugins/{b}/.claude-plugin/plugin.json")).get("dependencies", []))
bad = 0
for name in sorted(want):
    r = installed.get(f"{name}@moka-harness")
    src = market[name]["source"]
    if not r:
        print("FAIL not recorded:", name); bad += 1
    elif isinstance(src, dict) and r[0].get("gitCommitSha") != src.get("sha"):
        print("FAIL wrong commit:", name, r[0].get("gitCommitSha"), "pin", src.get("sha")); bad += 1
print(f"SUMMARY: {len(want) - bad} of {len(want)} members recorded at their pin")
sys.exit(1 if bad else 0)
PY
members=$?
claude plugin marketplace remove moka-harness >/dev/null 2>&1 || echo "FAIL marketplace remove"
left=$(python3 -c "import json;print(len(json.load(open('$SANDBOX/plugins/installed_plugins.json')).get('plugins',{})))")
echo "install records left after remove: $left"
echo "top-level leftovers: $(ls -A "$SANDBOX" | tr '\n' ' ')"
[ "$before" = "$(real_fingerprint)" ] && echo "real config unchanged" || { echo "FAIL real config changed"; members=1; }
[ "$members" = 0 ] && [ "$left" = 0 ] && pass "full install gate" || fail "full install gate"
