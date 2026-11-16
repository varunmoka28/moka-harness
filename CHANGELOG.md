# Changelog

Every change to a pinned commit of a third-party entry gets a line here naming the entry.

## Unreleased

- Added `leanrea` (aicodeking/leanrea, MIT) at `09ba4aa0217f82cd880f855a60b877f59f39b22b`, `hud` (jarrodwatts/claude-hud, MIT) at `9d2b6fa4df43c8ced61c0c23956fd291551726ac`, listed as `hud` because Claude Code reserves names starting with `claude-`, and `terminal-browser` (zenbu-labs/terminal-browser, MIT, its `claude-code-plugin` folder) at `b77065999de3fff271b6e3de29757b7ca1221fe3`.
- Added harness plugins `statusline` (coloured status line on top of `hud`), `repo-health` and `web-access`; `core-bundle` now includes them and `leanrea`.
- `multi-agent-kit` gained two tuios helper scripts, `tuios-send-verified.sh` and `tuios-worker-watch.sh`. Both need `TUIOS_SESSION`.
- README now asks for tuios as well as herdr and says what each is for.

- `core` now depends on `band-frame`, so the default install draws the coloured rule above the prompt. Before, only `core-bundle` carried it, and a `core`-only install showed no line between plugin output and the main session.

## v0.3.0 (2026-11-16)

- Removed the `cloud` group and the `aws-core` entry (aws/agent-toolkit-for-aws), pinned at `f18bffee72a2b35cb979a015926208fdab8b6548`. It needed an AWS account and credentials. `doctor` no longer checks for AWS credentials.
- Noted why `homunculus` left in v0.1.0: its repo has no LICENSE file, only an MIT line in the author's plugin.json. It is not in the marketplace.

## v0.2.0 (2026-11-16)

- Fixed clean-view: plan_steps and report_progress now read their arguments from the event, so its tool gate no longer denies every tool.
- Catalogue page on GitHub Pages (https://varunmoka28.github.io/moka-harness/), built from the marketplace by `scripts/build_catalogue.py`, with screenshots on nine entries.
- README shortened, with a banner, a plug icon and a request to install herdr first.
- The plugins in `plugins/` are called harness plugins, since most started from mods other people published.

## v0.1.0 (2026-11-15)

First release.

- Removed the `office-files` entry (docx, pdf, pptx, xlsx from anthropics/skills), pinned at `9d2f1ae187231d8199c64b5b762e1bdf2244733d`.
- Removed the `homunculus` entry (humanplane/homunculus), pinned at `59b6520f3b31fc5c31e57f7ffa3e7fee28a365c4`, and the `memory` bundle that held only it.
- Marketplace build, pin check, pin changelog check, credits generator, public export and CI checks added.
