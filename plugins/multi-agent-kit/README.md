# multi-agent-kit

One skill on splitting work between agents, two hooks and two helper scripts for people who run agents in tuios. herdr installs its own agent-state integration for Claude, so this plugin does not ship one.

## What it does

- **Skill `agent-orchestration`.** Guidance Claude reads when it plans to hand work to subagents or parallel sessions: one task per agent, its own files, a named check, its own git worktree when agents run in parallel, the brief in a file, the result in a file. The original skill also listed trigger words and one project-specific example prompt; nothing general was left in those parts, so they are dropped.
- **`tuios-status-hook.sh`** (UserPromptSubmit). Prints one line per window in your tuios session (name, agent state, minutes unchanged) and lists windows waiting on you, so Claude sees every agent you have running. Read-only.
- **`tuios-window-reaper.sh`** (SessionStart and Stop). Closes tuios windows that are finished or empty. See "What it deletes or stops".
- **`tuios-send-verified.sh`** (helper script, not a hook). Types a prompt into a Claude window in tuios and checks it was submitted, retrying Enter if text is left in the box. Never answers a question menu. Needs `TUIOS_SESSION` set to your session name. Usage: `send <window> <text>`, `enter <window>`, `check <window>`.
- **`tuios-worker-watch.sh`** (helper script, not a hook). Blocks until a worker window needs you: a `STATUS: done` or `STATUS: blocked` line in its task file, the window gone, or the agent waiting for input for two minutes. Prints why and the last screen lines. Needs `TUIOS_SESSION`.

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

## Running agents in tuios

Two rules come first, and the `agent-orchestration` skill tells Claude to follow both:

- **Ask before using tuios.** Before handing work to agents, Claude asks you whether to run them as tuios windows or as subagents inside the current session. It asks every time and never picks for you. Subagents need no setup. tuios windows are separate sessions that you can watch, answer and stop one by one.
- **Show the view where you asked.** The tuios view opens in the same herdr space as the agent you asked, never in a new Terminal window. If neither herdr nor the Herdr app is running, Claude asks you where to show it.

The steps below use `<session>` for your tuios session name. Set the plugin's `tuios_session` option to the same name so the status hook and the reaper see these windows.

1. **Create the session.** Do this once. It is created detached, so nothing takes over your terminal:

   ```bash
   export TUIOS_SERVER=<session>
   tuios new <session> --detach --cwd <repo>
   tuios close-window Terminal -s <session>   # the empty default window
   ```

   Start the daemon from a plain shell, not from inside a Claude session. A daemon started from Claude passes its `CLAUDE_CODE_*` variables to every window, and Claude agents in those windows then save no transcript. The reaper reads that transcript.

2. **Give each window its own worktree.** Agents running at the same time never share a checkout, because one agent's `git checkout` would switch the branch under the others:

   ```bash
   git -C <repo> worktree add ../<repo>-<task> -b <task>
   ```

3. **Open one window per agent, in auto mode**, so it never waits on a permission prompt. Put `--` before the agent command, or tuios reads the agent's flags as its own:

   ```bash
   tuios new-window <task> -s <session> --cwd ../<repo>-<task> --no-focus -- claude --permission-mode auto
   # Codex: -- codex --approve-for-me      agy: -- agy --mode auto
   ```

4. **Attach the view in the space you asked from.**
   - In the Herdr app (`HC_TERMINAL_ID` is set), the new terminal lands in the caller's space:

     ```bash
     herdr-core run --bg --name agents-tuios --outlive-parent --no-notify -- zsh -lc 'TUIOS_SERVER=<session> tuios attach <session>'
     ```

   - With the herdr CLI, reuse the `agents (tuios)` tab in the current workspace, or create it:

     ```bash
     herdr tab create --workspace <workspace-id> --label "agents (tuios)" --no-focus
     herdr pane run <pane-id> "TUIOS_SERVER=<session> tuios attach <session>"
     ```

     herdr renames the tab to `zsh` when the shell starts, so rename it back afterwards.

5. **Send a short prompt that points at the brief file.** A long `send-text` can arrive cut off:

   ```bash
   tuios send-text -s <session> -w <task> 'Read .dispatch/<task>.md and do it.'
   tuios send-keys -s <session> -w <task> Enter
   ```

   A window that is still starting can drop the Enter. Run `tuios capture-pane -s <session> -w <task>`, and if the text is still in the input box, send Enter again.

6. **End every brief with the `STATUS` line.** The brief tells the agent to write its report to a named file and to end its last message with `STATUS: done` or `STATUS: blocked`. The reaper closes a Claude window only after it reads `STATUS: done` in that agent's transcript. Without the line, the window stays open until it has been idle for `reaper_idle_minutes`.

While agents run, `tuios list-attention` shows every window waiting on you in one list. Close a window with `tuios close-window <task> -s <session>` once you have accepted its result, or let the reaper close it.

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
