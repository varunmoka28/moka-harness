# Changelog

Every change to a pinned commit of a third-party entry gets a line here naming the entry.

## v0.10.0 (2026-11-26)

- `disabled-index` 0.1.0: new in core. At session start it indexes the skills inside the plugins switched off in `settings.json`; on each prompt it prints at most two lines naming a disabled skill whose name matches the prompt, with the path of its `SKILL.md`. Plain word overlap, no model calls, nothing sent off the machine.
- `core-bundle` 0.1.1: lists `disabled-index` as a member.

## v0.9.0 (2026-11-24)

- `dispatch-router` 0.2.0: `/dispatch-router off` switches the router off for the current session (no launch checks, no routing call, status line cleared); `/dispatch-router on` restores it. A new session starts with it on.

## v0.8.1 (2026-11-24)

- `band-frame` 0.1.1: the top rule is a heavy line in the theme's blue accent colour, so the plugin band stands apart from the conversation above it. It was a thin tan line.

## v0.8.0 (2026-11-24)

- `side-chat` 0.4.8: a `/clear main` button between Clear and Close runs the main session's `/clear` (queued until the session is idle) and leaves the side thread; Clear still empties only the side thread. The first quick ask is labelled WRD? and still sends "What are you doing?".

## v0.7.1 (2026-11-22)

- `side-chat` 0.4.7: the Now button and `/now` are removed. With the main turn waiting on an agent, Now's note reached the model no sooner than Send's queued prompt. Send is unchanged: it queues behind a running main turn.

## v0.7.0 (2026-11-21)

- `multi-agent-kit` 0.2.0: the window reaper no longer closes a window on a `STATUS: done` line or after idle minutes (the `reaper_idle_minutes` setting is gone); it still closes empty shells and two-hour runaways, and gains `--done-line <cwd> <pid>`. The worker watch reads the named window, counts `STATUS: done` or `blocked` only at the start of a line, and ends on needs_input only when a prompt is on screen. The status hook flags finished Claude windows and windows idle 24 hours or more, and names the window that needs attention.
- `next-steps-autopilot` 0.6.1: a risky word the suggestion rules out ("No push", "don't force push or merge") no longer holds auto mode, and the reason a suggestion was held shows in the band's header row instead of a toast.
- `dispatch-router` 0.1.1: a Claude, Codex or agy launch typed through `herdr-app do tab.new` is routed like `send-keys` and `pane run`.
- `repo-health` 0.1.1: the skill says how to count worktrees across a whole workspace folder, one repo at a time.

## v0.6.2 (2026-11-21)

- `side-chat` 0.4.6: a side question that asks for a prompt is answered with only the prompt text, with no intro, explanation or closing line, on the fork, the Haiku fallback and `^name`.

## v0.6.1 (2026-11-21)

- The catalogue shows each harness plugin's version, and on every card the releases that changed it (from the CHANGELOG lines that name it), each linked to its GitHub release.

## v0.6.0 (2026-11-21)

- `side-chat` 0.4.5: card buttons sit on their own row as coloured pills (Copy, Draft, Send, Now, Fork), so they stay visible in a narrow pane (before, under about 170 terminal columns they were not drawn and Fork could not be pressed); quick asks are labelled Doing?, Explain and Next? and still send the full questions; Older and Newer pick the card Copy and Fork act on; Fork hands a question and answer to a full-tools agent in the same folder; `/btw ^name` reads a subagent that has just finished; up to 20 earlier side turns within 8,000 characters; `/clear`, `/new` and a history pick drop an answer still on its way; a side note is no longer appended to an idle main twice; fork answers show the main step they saw; the Haiku fallback lists tool names, says when there is no main context, and notes when an answer only wrote tool calls as text; quick ask "Explain that in plain words".
- `tab-namer` 0.7.0 also names the space and tab in the Herdr desktop app, through `herdr-core`. herdr in a terminal is unchanged and wins when both are present.

## v0.5.0 (2026-11-20)

- Added `scripts/sync_public.sh`: copies the published files over an existing public clone, refuses one with uncommitted changes, lists files only the public clone tracks without deleting them, and leak-scans. The published file set moved to `scripts/published_files.sh`, which `export_public.sh` now uses too.
- `scripts/credits.py` keeps a row's date checked unless its pin changed; before, every run re-dated every row.
- Added `human-in-the-loop` (tzafrir/human-in-the-loop, MIT) at `d8df5ff0ddc0dd00ff4d5e0955374de618dffdd4` (v0.1.10), in the core group; `core-bundle` now includes it.
- Added `autoharness` (tigerless-labs/autoharness, MIT) at `6d85325ab5ef436d1d4d52ffa82e43ea0365d144` (v0.5.3), as an add-on outside every group.
- `unattended` gained route mode (`/unattended route`, or `CLAUDE_UNATTENDED=route` with `CLAUDE_TASK_FILE`): a refused question is written to the worker's task file as `STATUS: blocked` and `QUESTION:` lines for the orchestrator, instead of Claude picking. Without a writable task file it falls back to on mode and says so.
- Added `merge-gate`: refuses a merge Claude runs (`git merge`, `gh pr merge`) when the branch touches files outside its declared scope, carries a secret or fails its tests, and stops after three failed rounds. The orchestrator sets the scope with `git config branch.<branch>.scope` (#1).

## v0.4.0 (2026-11-16)

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
