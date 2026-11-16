#!/usr/bin/env bash
# docs/index.html (the catalogue page) matches what scripts/build_catalogue.py builds now.
cd "$(dirname "$0")/../.." || exit 1
python3 scripts/build_catalogue.py --check || exit 1
grep -q 'src="shots/terminal-desk--pane.png"' docs/index.html && grep -q 'src="shots/secret-box.png"' docs/index.html || { echo "catalogue shots missing from docs/index.html"; exit 1; }
