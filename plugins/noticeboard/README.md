# noticeboard

A side pane beside the chat that does nothing until you type `/board`. Based on [decision-tree](https://github.com/ray-amjad/claude-code-mods/tree/main/plugins/decision-tree) by Ray Amjad (MIT).

It has two uses:

- **Explain a question.** `/board` reads the question at the end of Claude's latest reply and shows each option with what it leads to, pros and cons, and a recommended pick. `/board b` explores option B in a forked, read-only copy of the session and shows the next question. Nothing you explore reaches the main conversation.
- **Pin things to read.** `/board send` lets Claude pin what you ask for, such as "put that table on the board". Claude calls its `pin` tool, and the pane shows the newest pin with Older and Newer buttons. The tool doesn't exist in a session until you type `/board send`.

## Commands

| Command | What it does |
| --- | --- |
| `/board` | Explain the question at the end of the latest reply |
| `/board b` | Explore option B (A to H) |
| `/board other <answer>` | Explore your own answer |
| `/board map` | Every question and option explored, as one tree |
| `/board back`, `/board top` | Move up the tree |
| `/board continue` | Open the current branch as a live session |
| `/board send` | Let Claude pin on the board, and open it on the pins |
| `/board send off` | Stop Claude pinning; what is pinned stays |
| `/board off` | Close the board and forget everything |

## Limits

- Everything lives in the mod's memory: a restart or `/reload-plugins` clears the tree and the pins, and turns pinning off.
- Mermaid blocks show as source in the pane; ask for plain-text diagrams.
- An explanation is one model call; each explored option is a full `claude -p` run.
- Opened by a pin, the pane only places itself on a terminal at least 144 columns wide; `/board send` opens it at any width.

## What it does

See above.

## What it needs

Claude Code with plugin mods support and the `claude` command on the path. The `herdr` terminal manager is optional: `/board continue` uses it when `HERDR_ENV=1`.

## Hook events it uses

`session.start`, `command.run` (`/board`), `tool.call` (its own pin tool), `turn.complete`, and `ui.render` in the side pane.

## What it deletes or stops

Nothing. Exploring an option starts a child `claude -p --resume <id> --fork-session` with Read, Grep and Glob only (Bash, Edit and Write are disallowed) and a five minute limit. It does not change your session.

## What it sends off the machine

The child `claude` process sends the conversation to the model as any Claude Code session does. Nothing else leaves the machine.

## Develop

```
claude plugin validate plugins/noticeboard
claude plugin test plugins/noticeboard
```

In `claude -p`, set `NOTICEBOARD_WAIT=1` so the run waits for the fork before it exits.
