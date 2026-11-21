#!/usr/bin/env bash
# docs/index.html (the catalogue page) matches what scripts/build_catalogue.py builds now.
cd "$(dirname "$0")/../.." || exit 1
python3 scripts/build_catalogue.py --check || exit 1
grep -q 'src="shots/terminal-desk--pane.png"' docs/index.html && grep -q 'src="shots/secret-box.png"' docs/index.html || { echo "catalogue shots missing from docs/index.html"; exit 1; }
# Harness cards carry their version and the releases that changed them, read from CHANGELOG.md.
python3 -I - <<'EOF' || exit 1
import re, sys
t = open("docs/index.html", encoding="utf-8").read()
i = t.find("<h3><code>side-chat</code>")
card = t[i:t.find("</article>", i)]
ok = "<dt>Version</dt>" in card and re.search(r'releases/tag/v0\.6\.0">v0\.6\.0</a> \(0\.4\.5\)', card)
sys.exit(0 if ok else "side-chat card lacks Version or Updated in")
EOF
