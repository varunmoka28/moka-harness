---
name: doctor
description: Checks which outside tools and keys the installed moka-harness groups still need. Use after installing a group, or when something from a group does not work.
---

Run `bash "${CLAUDE_PLUGIN_ROOT}/skills/doctor/check.sh"` and tell the user what it printed in plain words: what is ready, what is missing, and the one-line way to get each missing item. Lines marked `unchecked` need the user to confirm by hand. Do not install anything yourself and do not read key values.
