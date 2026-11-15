# multi-agent-kit

One skill on splitting work between agents, and two hooks for people who run agents in tuios. herdr installs its own agent-state integration for Claude, so this plugin does not ship one.

## What it does

- **Skill `agent-orchestration`.** Guidance Claude reads when it plans to hand work to subagents or parallel sessions: one task per agent, its own files, a named check, its own git worktree when agents run in parallel, the brief in a file, the result in a file. The original skill also listed trigger words and one project-specific example prompt; nothing general was left in those parts, so they are dropped.
- **`tuios-status-hook.sh`** (UserPromptSubmit). Prints one line per window in your tuios session (name, agent state, minutes unchanged) and lists windows waiting on you, so Claude sees every agent you have running. Read-only.
- **`tuios-window-reaper.sh`** (SessionStart and Stop). Closes tuios windows that are finished or empty. See "What it deletes or stops".

## What it needs

- Optional: herdr, only for the `herdr_tab_label` option.
- tuios for the two tuios hooks, and `jq`. If tuios or jq is missing, both hooks do nothing.
- macOS for the reaper (`md5`, `stat -f`).
- Optional: Codex and agy, only if you run them in tuios windows. The reaper treats their windows by idle time alone.

Options:

| Option | Default | Use |
|---|---|---|
| `tuios_session` | empty | The tuios session both tuios hooks work in. Empty: they do nothing |
| `reaper_dry_run` | on | On: log what it would close. Off: close |
| `reaper_idle_minutes` | 15 | Idle time before a window with no working agent is closed |
| `herdr_tab_label` | empty | herdr tab to close when the session has no windows left. Empty: none |

## Hook events it uses

SessionStart (reaper), UserPromptSubmit (window list), Stop (reaper).

## What it deletes or stops

The reaper closes tuios windows, only inside the session named by `tuios_session`, and only when `reaper_dry_run` is off. It closes a window when:

1. it holds a bare shell with no child process;
2. it is a Claude window whose agent has finished and whose last message ends with a line `STATUS: done` (read from the agent's transcript under `~/.claude/projects`, not from the screen);
3. its screen has not changed for `reaper_idle_minutes` and no agent is working;
4. an agent has been in the working state for over 2 hours, unless the window's name is listed in `reaper.keep` under the plugin data folder.

It never touches a window that tuios lists as waiting for approval, an answer, a plan or after an error. The last screen of a closed window is saved under `closed/` in the plugin data folder. With `herdr_tab_label` set, it closes the herdr tab with that label once no windows remain.

Every action, including each "would close" in dry-run, is written to `reaper.log` in the plugin data folder (`CLAUDE_PLUGIN_DATA`). The test is `tests/multi-agent-kit/test_hooks.sh`, which runs the reaper against a temporary HOME with a fake `tuios` on PATH.

## What it sends off the machine

Nothing.
