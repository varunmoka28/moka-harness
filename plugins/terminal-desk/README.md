# Terminal Desk

A session dashboard for Claude Code. It puts a one-line stats bar above the prompt and adds a `/desk` pane with more detail.

Needs Claude Code v2.1.287 or later. It was built and tested on v2.1.289 in the terminal.

## What it does

Adds a stats bar above the prompt and a `/desk` pane. The bar is drawn from numbers Claude Code already keeps. The pane lists the assumptions Claude reports, work it left undone, feedback drafts, where the context went, subagents, and your other open sessions. The sections below describe each part.

This is [Terminal Desk](https://www.graniteai.co/tools/terminal-desk) by ClariSortAi (MIT), with local changes made by Varun Moka for this marketplace: it reads one Claude config folder (`CLAUDE_CONFIG_DIR`, or `~/.claude` when unset) and the second-account handling was removed. Their copyright line and licence stay in `LICENSE`.

## What it needs

- Claude Code v2.1.287 or later. It was built and tested on v2.1.289 in the terminal.
- Optional: `herdr` (`HERDR_BIN_PATH`, `HERDR_SOCKET_PATH`) so a click on another session goes to its tab. Without it the sessions are listed and clicks do nothing.
- Optional: `tail`, for reading the end of session transcripts.
- Optional: the `session-peers` plugin, whose notes add a prompt label and tab to each listed session.

## Hook events it uses

`agent.spawn`, `command.run` (`/desk`), `prompt.compose`, `prompt.submit`, `session.compact`, `session.start`, `tool.call`, `turn.step`, `turn.complete`, `ui.close`, `ui.render`.

It reads session files, transcripts and `session-peers` notes under the config folder, and asks `herdr` for its tab list.

## What it deletes or stops

Nothing. The only thing it removes is a feedback draft you delete with `t` in the pane.

## What it sends off the machine

Nothing, unless you run `/desk check on`. With the check on, after each turn that made five or more tool calls, it sends your request and the last 6000 characters of Claude's final report to Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) through Claude Code's own model call, to find work the report admits to leaving undone. `/desk check off` stops it. The assumptions panel adds about 200 tokens to the system prompt and registers one tool, `note_assumption`.

## The bar

The bar has three parts. On the left: whether Claude is working and how many other sessions are open on the machine (press `d` or click it to open `/desk`). In the centre: a 0 to 100 bar of context used. On the right: tokens read and written so far, counted per request and including subagents, then cost, then how long the prompt cache stays warm.

On a narrow terminal the bar drops tokens first, then cache, instead of wrapping.

When you switch to a subagent's transcript, the bar switches to that subagent's status, run time, tool calls, tokens and model.

## The pane

`/desk` opens a pane with five panels.

**What Claude is assuming** lists the last five judgment calls Claude reported, newest first, each with its reason and what it affects. Press the number next to an entry, or click its Reject button, to put a correction in your prompt box. Nothing is sent until you finish the sentence and press Enter. If Claude later overturns an assumption itself, the old entry is struck through.

**Left undone** lists work Claude put off. It is filled three ways: sentences in Claude's answer that defer something ("for now", "I did not run", "placeholder"), lines it writes into a file that mark unfinished work (`TODO`, a skipped test, "not implemented"), and a second, small model that reads your request against Claude's final report after any turn with five or more tool calls. Press the letter next to an entry to draft "You left this undone: ... Do it now." in your prompt box. `x` clears the list.

**Feedback drafts** holds the feedback Claude drafts with its SendFeedback tool, so the engine's card never pops up above the prompt. Nothing is sent until you press `s`. `t` deletes the draft. The last 10 drafts are kept across restarts.

**Where your context went** is a stacked bar of what fills the context window (messages, system tools, skills, memory files and so on), with a legend and the free space left.

**Subagents** lists every subagent in the session with its status, type, model, run time and tool calls.

**Other sessions** lists every other terminal Claude session on the machine, in the Claude config folder (`CLAUDE_CONFIG_DIR`, or `~/.claude` when it is not set), with sessions in another folder tagged with that folder. Click one to go to its herdr tab; this works from outside herdr too, since the mod finds the running herdr session itself. A session outside herdr cannot be targeted, so clicking it does nothing.

## Commands

| Command | What it does |
| :- | :- |
| `/desk` | Open the pane |
| `/desk hide` | Hide the bar |
| `/desk show` | Show the bar again |
| `/desk check off` | Stop sending finished turns to the second model (the default) |
| `/desk check on` | Turn the second-model check on |
| `/desk cache 5m` | Count down a 5-minute cache |
| `/desk cache 1h` | Count down a 1-hour cache (the default) |

## What it adds to your sessions

The bar and the pane are drawn locally from numbers Claude Code already keeps. Drawing them makes no model calls and no network calls.

The assumptions panel is the one part that costs tokens. It adds a short instruction to the system prompt (roughly 200 tokens) and registers one tool, `note_assumption`, that Claude calls when it makes a judgment call you did not state. Each logged assumption is a small tool call, and when Claude logs one as a separate step, that is one extra request at the cached rate. On a large conversation that can be several cents each.

The Left undone panel's scanning is local and free. Its second-model check is off until you run `/desk check on`; when on, it is one small request to Claude Haiku 4.5 after each turn that made five or more tool calls, sent with your request and the last part of Claude's answer. `/desk check off` stops it again.

## What to know about the numbers

- Claude Code does not tell a mod how long the prompt cache lasts, so the mod assumes one hour unless you run `/desk cache 5m`.
- The one-hour cache applies to a Claude subscription within its included usage. On an API key or a cloud provider the default is five minutes, so run `/desk cache 5m` there.
- On a Team or Enterprise plan, or a machine with managed settings, Claude Code stops a mod you install yourself from changing the system prompt, so the assumptions panel may stay empty.
- Left undone is a prompt to look, not a verdict. The phrase scan flags innocent sentences sometimes, and the second model reads Claude's report and not its tool calls, so it finds what the report admits to.
- Context and cache figures describe the main conversation. Subagents get their own status but not their own context breakdown.

## Before you install

Mods are not sandboxed. This one reads context usage, tool call names and subagent activity, adds text to the system prompt, and registers a tool. It reads the text Claude writes into files to look for unfinished-work markers. The whole mod is one file, [`hooks/register.tsx`](./hooks/register.tsx), so you can check that for yourself.

## License

MIT. Copyright (c) 2026 ClariSortAi, with changes copyright (c) 2026 Varun Moka. See `LICENSE`.
