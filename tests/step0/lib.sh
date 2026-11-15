#!/usr/bin/env bash
# Shared helpers for the step 0 pin-proof tests. Source this file; do not run it.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURE="$REPO_ROOT/tests/step0/fixture-marketplace"
MARKET="moka-step0"
# The config the developer really uses, captured before any sandbox is set up.
REAL_CONFIG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# A fresh, empty Claude config folder. It is left in the temp folder for the OS to clear.
sandbox_up() {
  SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/moka-step0.XXXXXX")"
  # Physical path, so a TMPDIR with a trailing slash or a symlink does not break path checks.
  SANDBOX="$(cd "$SANDBOX" && pwd -P)"
  export SANDBOX
  export CLAUDE_CONFIG_DIR="$SANDBOX"
}

# sha256 of the real config's install record, to prove a test did not touch it.
# known_marketplaces.json is left out: any running Claude session rewrites it when it
# refreshes a marketplace, which made this check fail with no test at fault.
real_fingerprint() {
  cat "$REAL_CONFIG/plugins/installed_plugins.json" 2>/dev/null \
    | shasum -a 256 | cut -d' ' -f1
}

# installed_field <plugin-id> <field>: one field of the sandbox's install record.
installed_field() {
  python3 - "$SANDBOX/plugins/installed_plugins.json" "$1" "$2" <<'PY'
import json, os, sys
path, plugin_id, field = sys.argv[1:4]
if os.path.exists(path):
    records = json.load(open(path)).get("plugins", {}).get(plugin_id, [])
    if records:
        print(records[0].get(field, ""))
PY
}

add_fixture() {
  claude plugin marketplace add "$FIXTURE" >/dev/null \
    || fail "could not add the fixture marketplace"
}
