# side-chat

## What it does

Adds `/btw`, a side pane for follow-up questions that does not touch the main conversation. It replaces the built-in `/btw` while installed. Call a subagent with `/btw @name question`. An answer can be copied, drafted into the prompt box, or sent to the main chat. Threads survive `/clear`. The design notes are in [`DESIGN.md`](./DESIGN.md). Independent mod, not made by Anthropic.

## What it needs

- macOS. The copy action runs `pbcopy`; on other systems it reports "Copy failed" and the rest works.
- Claude Code with mod support (hooks modules, `$.model.fork`, `$.session.append`).

## Hook events it uses

`session.start`, `command.run` (`/btw`), `turn.start`, `turn.complete`, `ui.input`, `ui.press`, `ui.render` (a pane).

## What it deletes or stops

Nothing. It can clear its own side-chat threads when you ask it to.

## What it sends off the machine

Each question goes to a model through Claude Code's own model call, and nothing goes anywhere else:

- A plain question forks the main conversation, so the model sees the whole main conversation, the last few side-chat turns, your question and the list of running subagents.
- If the fork fails (a fresh or cleared session, an API error), Claude Haiku answers instead from the last 60,000 characters of the main conversation's text plus the same side-chat turns and question.
- `/btw @name question` starts that subagent with only your question. Its model is set by the `agentModel` setting (`haiku` by default).
- "Send to main chat" appends your text to the main session as a message. Nothing else is written to it.
