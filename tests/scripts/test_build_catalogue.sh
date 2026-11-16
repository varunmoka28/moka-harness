#!/usr/bin/env bash
# docs/index.html (the catalogue page) matches what scripts/build_catalogue.py builds now.
cd "$(dirname "$0")/../.." || exit 1
python3 scripts/build_catalogue.py --check
