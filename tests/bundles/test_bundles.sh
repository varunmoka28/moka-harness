#!/usr/bin/env bash
# Bundle plugins: every dependency is a marketplace entry; jev installs its members.
source "$(dirname "$0")/../step0/lib.sh"
cd "$REPO_ROOT"
BUNDLES="core-bundle writing design media research multi-agent jev"
BEFORE="$(real_fingerprint)"

# 1. Every dependency of all eight bundles has an entry in marketplace.d/.
python3 - $BUNDLES <<'PY' || fail "a bundle depends on a name with no marketplace entry"
import glob, json, sys
names = {e["name"] for f in glob.glob("marketplace.d/*.json") for e in json.load(open(f))}
bad = 0
for b in sys.argv[1:]:
    deps = json.load(open(f"plugins/{b}/.claude-plugin/plugin.json")).get("dependencies", [])
    if not deps: print(f"{b}: no dependencies"); bad += 1
    for d in deps:
        if d not in names: print(f"{b}: missing entry {d}"); bad += 1
    if b not in names: print(f"{b}: bundle has no entry"); bad += 1
sys.exit(bad)
PY
pass "all eight bundles list only dependencies that have an entry"

# 2. Install jev from a local marketplace holding the real entries; check members.
sandbox_up
MK="$SANDBOX/market"; mkdir -p "$MK/.claude-plugin"
python3 - "$MK" <<'PY'
import glob, json, os, sys
mk = sys.argv[1]
entries = [e for f in sorted(glob.glob("marketplace.d/*.json")) for e in json.load(open(f))]
for e in entries:
    if isinstance(e["source"], str):
        os.makedirs(os.path.join(mk, "plugins"), exist_ok=True)
        dst = os.path.join(mk, e["source"][2:])
        if not os.path.lexists(dst): os.symlink(os.path.abspath(e["source"]), dst)
json.dump({"name": "moka-bundles-test", "owner": {"name": "moka-harness"}, "plugins": entries},
          open(os.path.join(mk, ".claude-plugin/marketplace.json"), "w"))
PY
claude plugin marketplace add "$MK" >/dev/null || fail "could not add the test marketplace"
M="moka-bundles-test"
for b in jev; do
  claude plugin install "$b@$M" >/dev/null || fail "install of $b failed"
  [ -n "$(installed_field "$b@$M" installPath)" ] || fail "$b not recorded"
  for d in $(jq -r '.dependencies[]' "plugins/$b/.claude-plugin/plugin.json"); do
    [ -n "$(installed_field "$d@$M" installPath)" ] || fail "$b member $d not recorded"
  done
done
[ -z "$(installed_field "writing@$M" installPath)" ] || fail "writing was installed though not asked for"
[ "$(real_fingerprint)" = "$BEFORE" ] || fail "the real config changed"
pass "jev installed with every member recorded; real config untouched"
