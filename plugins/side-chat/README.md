# side-chat

## What it does

Adds `/btw`, a side pane for follow-up questions that does not touch the main conversation. It replaces the built-in `/btw` while installed. Call a subagent with `/btw @name question`. An answer can be copied, drafted into the prompt box, sent to the main chat, or handed to a Fork; each card's buttons are coloured so they are easy to tell apart. Older and Newer pick the card that Copy and Fork act on. `/btw ^name question` answers from a subagent's transcript, also shortly after it has finished. Threads survive `/clear`; `/clear`, `/new` and a history pick drop an answer still on its way. Fork answers show which main-conversation step they saw. The design notes are in [`DESIGN.md`](./DESIGN.md). Independent mod, not made by Anthropic.

## What it needs

- macOS. The copy action runs `pbcopy`; on other systems it reports "Copy failed" and the rest works.
- Claude Code with mod support (hooks modules, `$.model.fork`, `$.session.append`).

## Hook events it uses

`session.start`, `command.run` (`/btw`), `turn.start`, `turn.step`, `turn.complete`, `tool.call` (keeps `/btw @name` agents read-only), `ui.input`, `ui.press`, `ui.render` (a pane).

## What it deletes or stops

Nothing by itself. It can clear its own side-chat threads when you ask it to.

Fork is different: it starts a background agent with full tools, in the same folder as the main session. That agent can edit and delete files, and it can edit the same file as the main session at the same time. Agents called with `/btw @name` stay read-only: a `tool.call` guard refuses their edits.

## What it sends off the machine

Each question goes to a model through Claude Code's own model call, and nothing goes anywhere else:

- A plain question forks the main conversation, so the model sees the whole main conversation, up to the last 20 side-chat turns that fit in 8,000 characters, your question and the list of running subagents.
- If the fork fails (a fresh or cleared session, an API error), Claude Haiku answers instead from the last 60,000 characters of the main conversation's text, with the names (not the results) of the tools each turn used, plus the same side-chat turns and question. With no main conversation (after `/clear`) it answers from the side thread only and marks the card "no main context".
- `/btw @name question` starts that subagent with only your question. Its model is set by the `agentModel` setting (`haiku` by default).
- `/btw ^name question` sends that subagent's transcript and your question to the same model call, read-only.
- Fork sends the question and answer to a new agent that inherits the main conversation.
- "Send to main chat" appends your text to the main session as a message. Nothing else is written to it.
