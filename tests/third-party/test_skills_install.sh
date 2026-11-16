#!/usr/bin/env bash
# Installs every third-party skill entry from marketplace.d/third-party-skills.json in a
# sandbox config folder. For each entry it checks that the recorded commit is the pin and
# that every skill the entry is meant to carry is in the installed copy.
# Some repos are large; this takes several minutes and needs network access.
source "$(dirname "$0")/../step0/lib.sh"

M="moka-tp-skills-test"
before="$(real_fingerprint)"
sandbox_up

MK="$SANDBOX/market"
mkdir -p "$MK/.claude-plugin"
python3 - "$REPO_ROOT/marketplace.d/third-party-skills.json" "$MK/.claude-plugin/marketplace.json" "$M" <<'PY'
import json, sys
entries = json.load(open(sys.argv[1]))
json.dump({"name": sys.argv[3], "owner": {"name": "moka-harness"}, "plugins": entries},
          open(sys.argv[2], "w"), indent=2)
PY

claude plugin marketplace add "$MK" >/dev/null || fail "could not add the temporary marketplace"

# entry: skill names it must carry (a skill matches on its folder name or its frontmatter name)
EXPECTED='humanizer: humanizer
anti-slop: antislop antislop-code antislop-copywriting antislop-human antislop-layoutmobile antislop-ui
sepia: sepia sepia-hemingway sepia-recreate sepia-refactor sepia-review sepia-write
unslop: unslop
no-ai-slop: no-ai-slop
caveman: caveman
unlazy: unlazy
pocock-skills: grilling grill-with-docs diagnosing-bugs domain-modeling writing-for-agents
debug-agent: debug-agent
health: health
tare: tare
gstack: gstack benchmark browse careful codex design-review document-release freeze guard investigate learn qa qa-only retro review ship
diagram-skills: archimate architecture bpmn canvas cloud data-analytics graphviz infocard infographic iot network security uml vega
fireworks-tech-graph: fireworks-tech-graph
anatomy: anatomy
awwwards: awwwards
frontend-design: frontend-design
accessibility: accessibility
reanimate: reanimate
blank-page: blank-page
infographics: infographics
hyperframes: hyperframes hyperframes-cli hyperframes-registry media-use slideshow
gpt-image-2: gpt-image-2
make-ugc: make-ugc
k-dense-science: datacommons-client edgartools fred-economic-data generate-image geopandas literature-review market-research-reports markitdown matplotlib openalex-database parallel-web peer-review perplexity-search research-grants research-lookup scientific-schematics scientific-slides scientific-visualization scientific-writing scikit-learn writing
orchestra-research: 0-autoresearch-skill
book-to-skill: book-to-skill
anysearch: anysearch
agent-reach: agent-reach
graphify: graphify
big-arrow: big-arrow
supabase-skills: supabase supabase-postgres-best-practices
treg: treg'

# skills_in <installPath>: every SKILL.md folder name and frontmatter name under it, one per line
skills_in() {
  python3 - "$1" <<'PY'
import os, re, sys
for root, dirs, files in os.walk(sys.argv[1]):
    dirs[:] = [d for d in dirs if d != ".git"]
    for f in files:
        if f.lower() == "skill.md":
            print(os.path.basename(root))
            m = re.search(r"^name:\s*['\"]?([^'\"\n]+)", open(os.path.join(root, f), errors="ignore").read(), re.M)
            if m:
                print(m.group(1).strip())
PY
}

failed=0
while IFS= read -r line; do
  name="${line%%:*}"
  want="${line#*: }"
  # ONLY="entry ..." limits a run to those entries while iterating.
  if [ -n "${ONLY:-}" ] && [[ " $ONLY " != *" $name "* ]]; then continue; fi
  pin="$(python3 - "$REPO_ROOT/marketplace.d/third-party-skills.json" "$name" <<'PY'
import json, sys
print(next(e for e in json.load(open(sys.argv[1])) if e["name"] == sys.argv[2])["source"]["sha"])
PY
)"
  if ! claude plugin install "$name@$M" >/dev/null 2>&1; then
    echo "FAIL: install of $name failed"; failed=1; continue
  fi
  got="$(installed_field "$name@$M" gitCommitSha)"
  if [ "$got" != "$pin" ]; then
    echo "FAIL: $name recorded '$got', pin is $pin"; failed=1; continue
  fi
  path="$(installed_field "$name@$M" installPath)"
  have="$(skills_in "$path")"
  missing=""
  for s in $want; do
    grep -Fxq "$s" <<< "$have" || missing="$missing $s"
  done
  if [ -n "$missing" ]; then
    echo "FAIL: $name is installed at its pin but lacks:$missing"; failed=1; continue
  fi
  pass "$name at its pin with its skills"
done <<< "$EXPECTED"

# The real config must hold no trace of this test's marketplace or plugins.
if grep -qs "$M" "$REAL_CONFIG/plugins/known_marketplaces.json" "$REAL_CONFIG/plugins/installed_plugins.json"; then
  fail "the real plugin registry mentions $M"
fi
pass "real plugin registry holds no trace of $M"
# Other Claude sessions on the machine rewrite known_marketplaces.json (refresh times), so a
# changed fingerprint alone is a note, not a failure.
if [ "$before" = "$(real_fingerprint)" ]; then
  pass "real plugin registry fingerprint unchanged"
else
  echo "NOTE: real plugin registry fingerprint changed; no trace of $M in it, so another session wrote it"
fi
[ "$failed" -eq 0 ] || { echo "SUMMARY: some entries failed"; exit 1; }
echo "SUMMARY: every entry installed at its pin with its skills"
