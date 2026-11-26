# Wiring

What each of this repo's harness plugins adds to a Claude Code session, read from the plugin code and its `hooks.json` and `plugin.json`. Third-party entries are not covered here: they are the authors' code, listed in the [trust table](trust-table.md).

How to read it:

- **Events** are the hook events the plugin registers. Most mods here use Claude Code's mod events (`session.start`, `turn.complete`, `tool.call`, `prompt.submit`, `ui.render` and so on). `core`, `fork-cleanup` and `multi-agent-kit` use ordinary command hooks (`SessionStart`, `PreToolUse` and so on). An event named `classic.X` is Claude Code's own hook event `X`, caught by a mod.
- **Commands** are the slash commands the plugin adds.
- **Tools** are the tools the plugin registers for Claude to call.
- **Settings** are the plugin's options (`userConfig`, asked when you enable it) and the environment variables its code reads.
- **Writes** lists files it creates, from its README.

No plugin here edits your `settings.json` or `CLAUDE.md`; a search of the plugin code finds only reads of them. The status line is not set by any plugin; `/core:doctor` prints the setting for you to add yourself if you want it. The code has no place where a personal integration was cut out and a stub left behind: where a plugin needs a key or an outside tool it shows a notice or does nothing, and the README of that plugin says which.

Bundle plugins (`core-bundle`, `writing`, `design`, `media`, `research`, `multi-agent`, `jev`) have no hooks of their own. They list their members as dependencies, so installing one also installs its members, including third-party plugins that run hooks (see the [trust table](trust-table.md)). Some bundles carry MCP servers; those are listed at the end.

| Plugin | Events | Commands | Tools | Settings | Writes |
|---|---|---|---|---|---|
| `agent-board` | `command.run`, `session.start` | `/tabs` | none | `AGENT_BOARD_COMPACT=1 (off by default)` | none |
| `assumption-log` | `command.run`, `prompt.compose`, `session.end`, `session.start`, `tool.call`, `ui.render` | `/assumptions` | `note_assumption` | none | none |
| `band-frame` | `ui.render` | none | none | none | none |
| `big-read-guard` | `session.start`, `tool.call` | none | none | none | none |
| `disabled-index` | SessionStart, UserPromptSubmit | none | none | none | disabled-plugins.md in the plugin data folder. |
| `cache-clock` | `session.compact`, `session.start`, `turn.complete`, `turn.start`, `ui.render` | none | none | `CACHE_CLOCK_TTL_MINUTES` | none |
| `clean-view` | `classic.Notification`, `classic.PermissionDenied`, `classic.PostToolUse`, `classic.PostToolUseFailure`, `classic.StopFailure`, `command.run`, `prompt.compose`, `prompt.submit`, `session.start`, `tool.call`, `turn.complete`, `turn.start`, `ui.render` | `/simple` | `plan_steps`, `report_progress` | none | none |
| `collision-guard` | `session.start`, `tool.call` | none | none | none | none |
| `context-guard` | `prompt.submit`, `session.end`, `session.start`, `turn.complete`, `turn.start` | none | none | `CONTEXT_GUARD_AUTO_COMPACT=1 (off by default)` | none |
| `core` | SessionStart (all and startup), PreToolUse on Bash, PostToolUse on Bash (only for gh pr merge) | none | none | `delete_guard_dry_run`, `protected_paths`, `worktree_sweep_dry_run`, `worktree_sweep_roots`, `reaper_dry_run`, `reaper_max_age_hours`, `reaper_match` | delete-guard.log, worktree-sweep.log and stale-agent-reaper.log in the plugin data folder. |
| `design-direction` | `prompt.compose`, `tool.call` | none | none | none | HTML files in /tmp/design-direction, deleted when a day old. |
| `disk-sweep` | `command.run`, `session.start`, `ui.render` | `/disk` | none | `dryRun`, `deleteRoots`, `alsoSweep` | Log in the plugin data folder. |
| `dispatch-router` | `session.start`, `tool.call` | none | `route` (as mcp__dispatch-router__route) | `typesafeApiKey`, `runners`, `claudeModelLow`, `claudeModelMid`, `claudeModelHigh`, `codexModel`, `agyModelLow`, `agyModelHigh`, `claudeFlags`, `codexFlags`, `agyFlags`, `briefFiles`, `allowCloud`, `localOnlyPattern`, `TYPESAFE_API_KEY (also the typesafeApiKey option)` | dispatch-router.log.jsonl in the plugin data folder. |
| `fork-cleanup` | SessionStart | none | none | `github_account`, `delete_forks`, `min_age_days`, `keep` | fork-cleanup.log in the plugin data folder. |
| `idea-shelf` | `command.run`, `session.start`, `ui.render` | `/idea`, `/ideas` | none | none | none |
| `image-shrinker` | `tool.call` | none | none | none | Temporary copies in /tmp/claude-shrunk, removed right after the read. |
| `input-router` | `command.run`, `prompt.submit`, `session.end`, `session.start`, `tool.call`, `tool.check`, `ui.render` | `/input-router` | none | none | Saved large results in a private folder under /tmp. |
| `layman` | `command.run`, `prompt.submit`, `session.start` | `/layman` | none | none | none |
| `merge-gate` | `tool.call` | none | none | `testCommand` | merge-gate-ledger.jsonl in the plugin data folder. |
| `multi-agent-kit` | SessionStart, UserPromptSubmit, Stop | none | none | `tuios_session`, `reaper_dry_run`, `herdr_tab_label` | reaper.log, reaper.seen and a closed/ folder of last screens, in the plugin data folder. |
| `next-steps-autopilot` | `command.run`, `prompt.edit`, `prompt.submit`, `session.end`, `session.start`, `turn.complete`, `turn.start`, `ui.render` | `/auto` | none | `minAnswerChars`, `suggestSkills`, `autoSeconds` | none |
| `noticeboard` | `classic.Stop`, `command.run`, `session.start`, `tool.call`, `turn.complete`, `ui.render` | `/board` | `pin` (registered only after /board send) | `NOTICEBOARD_WAIT` | none |
| `park` | `command.run`, `session.end`, `session.start`, `turn.complete` | `/park`, `/unpark` | none | none | A .park folder with notes. |
| `prompt-enhancer` | `prompt.submit`, `turn.complete`, `ui.render` | none | none | `TYPESAFE_API_KEY` | jev-router-usage.jsonl (token counts only) in the plugin data folder. |
| `read-fence` | `command.run`, `session.start`, `skill.prompt`, `tool.call` | `/read-fence` | none | `configDirs`, `exempt` | read-fence.json in the first config folder, only when you run /read-fence on or off. |
| `reddit-watch` | `classic.SessionStart`, `command.run`, `session.start`, `ui.render` | `/reddit` | none | none | none |
| `run-ledger` | `agent.spawn`, `command.run`, `http.fetch`, `model.classify`, `model.complete`, `model.fork`, `session.append`, `session.start`, `tool.call`, `turn.complete`, `turn.start`, `turn.step`, `ui.render` | `/run-ledger` | none | `TYPESAFE_API_KEY`, `mode`, `budgetUsd` | A JSON file only when you run /run-ledger export. |
| `session-peers` | `session.end`, `session.start`, `tool.call`, `tool.check`, `turn.complete`, `turn.start` | none | none | none | One small JSON file per session under the config folder. |
| `side-chat` | `command.run`, `session.start`, `turn.complete`, `turn.start`, `ui.input`, `ui.press`, `ui.render` | `/side` (also answers the built-in /btw) | none | `yourColor`, `instructions`, `takeKeyboard`, `agentModel` | none |
| `skills-az` | `command.run`, `prompt.edit`, `prompt.submit`, `session.start`, `ui.render` | `/skills-az` | none | none | none |
| `strict-guard` | tool.call on Bash | none | none | none | none |
| `tab-namer` | `command.run`, `prompt.submit`, `session.start`, `turn.complete` | `/tab-namer` | none | none | One on/off value in the mod's own store. |
| `terminal-desk` | `agent.spawn`, `command.run`, `prompt.compose`, `prompt.submit`, `session.compact`, `session.start`, `tool.call`, `turn.complete`, `turn.step`, `ui.close`, `ui.render` | `/desk` | `note_assumption` | none | none |
| `unattended` | `session.start`, `command.run`, `tool.call` | `/unattended` | none | `CLAUDE_UNATTENDED` | none |

`core` also adds the skill `/core:doctor`, which only reads. `multi-agent-kit` adds the skill `agent-orchestration`.

## MCP servers carried by bundles

| Bundle | Server | Starts with | Setting it asks for |
|---|---|---|---|
| `core-bundle` | `context7` | `npx -y @upstash/context7-mcp@4.7.0` | `context7_api_key` |
| `research` | `alphaxiv` | `HTTP https://api.alphaxiv.org/mcp/v1` | `alphaxiv_token` |
| `multi-agent` | `claude-peers` | `bun ${user_config.claude_peers_dir}/server.ts` | `claude_peers_dir` |
| `multi-agent` | `kanzo` | `kanzo mcp` | none |
