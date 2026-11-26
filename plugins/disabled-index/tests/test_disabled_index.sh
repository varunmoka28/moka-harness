#!/usr/bin/env bash
# Builds the index from a fake config folder and checks the hint fires only on a matching prompt.
set -u
HOOK="$(cd "$(dirname "$0")/.." && pwd)/hooks/disabled_index.py"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/cfg/plugins" "$T/cache/pdf-tools/skills/merge-pdf-pages" "$T/cache/on-plugin/skills/other"
printf -- '---\nname: merge-pdf-pages\ndescription: Merge several PDF files into one document, keeping page order\n---\nbody\n' > "$T/cache/pdf-tools/skills/merge-pdf-pages/SKILL.md"
printf -- '---\nname: other\ndescription: Merge pdf pages too\n---\n' > "$T/cache/on-plugin/skills/other/SKILL.md"
echo '{"enabledPlugins": {"pdf-tools@m": false, "on-plugin@m": true}}' > "$T/cfg/settings.json"
echo "{\"plugins\": {\"pdf-tools@m\": [{\"installPath\": \"$T/cache/pdf-tools\"}], \"on-plugin@m\": [{\"installPath\": \"$T/cache/on-plugin\"}]}}" > "$T/cfg/plugins/installed_plugins.json"
export CLAUDE_CONFIG_DIR="$T/cfg" CLAUDE_PLUGIN_DATA="$T/data"
fail() { echo "FAIL: $1"; exit 1; }

python3 "$HOOK" build || fail "build exited non-zero"
grep -q '^## pdf-tools$' "$T/data/disabled-plugins.md" || fail "disabled plugin missing from index"
grep -q 'on-plugin' "$T/data/disabled-plugins.md" && fail "enabled plugin listed"
out="$(echo '{"prompt": "please merge these pdf pages into one file"}' | python3 "$HOOK" hint)"
echo "$out" | grep -q "Disabled skill \`merge-pdf-pages\` (pdf-tools)" || fail "no hint for a matching prompt: $out"
echo "$out" | grep -q "$T/cache/pdf-tools/skills/merge-pdf-pages/SKILL.md" || fail "hint path wrong: $out"
[ -z "$(echo '{"prompt": "fix the login bug"}' | python3 "$HOOK" hint)" ] || fail "hint on an unrelated prompt"
[ -z "$(echo 'not json' | python3 "$HOOK" hint)" ] || fail "output on bad input"
echo "PASS disabled-index"
