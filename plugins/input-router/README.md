# input-router

Hands large file reads and connector results to a small model first, so Claude gets short notes on what matters for your task plus the path to the full text.

## What it does

When Claude reads a long file, the whole text lands in the chat and stays there for the rest of the session. Say you ask "what did we decide about refunds?" and Claude opens a 15,000-token call transcript. With this mod on, Haiku reads the transcript, keeps the refund decision with its time stamp, owner and ticket number, and Claude gets about 300 tokens of notes and the file's path. If the notes are not enough, Claude reads the parts it needs, or the whole file again.

This leaves more room in the chat before it fills up and compacts. Whether it saves money depends on how you work; see "How much it saves" below.

## Install

```
claude plugin marketplace add varunmoka28/moka-harness
claude plugin install input-router@moka-harness
```

## How to use

The mod starts off.

- `/input-router on` turns it on. `/input-router off` turns it off.
- `/input-router status` says whether it is on and which model it uses.
- `/input-router model haiku` or `/input-router model sonnet` picks the model that reads for Claude. Haiku is the default.
- `/input-router savings` shows this chat's totals.
- `/input-router panel` opens the "Haiku hand-offs" panel.

The panel opens by itself at the first hand-off on a terminal at least 144 columns wide; on a narrower one you get a short message telling you how to open it. Each card shows the file or connector, its size before and after, the estimated cost of the small model's request, how long it took, links to the notes and to the full text, and the notes themselves when you press "Show the notes Claude got".

## What gets handed off

- A file Claude reads whole, when its text is about 5,000 tokens or more (characters divided by 4). Below that, the small model's notes save too little to be worth the call.
- A connector (MCP) result from a tool whose name starts with a read word such as get, list, search or fetch, over the same size. First a plain script removes empty fields and system metadata (no model call); if that alone brings it under the line, Claude gets the trimmed copy and no model is asked. Otherwise the trimmed copy is saved to a private file and the small model reads it.

Reads by subagents are handed off too, since their tool calls pass through the same hooks.

These always reach Claude whole:

- a read with `offset`, `limit` or `pages` (Claude asked for those exact lines)
- images, PDFs and notebooks
- errors, refusals, and anything under the size line
- a file Claude reads a second time in the same chat, so it can edit from the real text
- a connector result that is a single record, or that holds a record a write call changed earlier in the chat
- a connector result with images or a structured record in it
- anything over about 150,000 tokens, which the small model could not read in one go

A connector result too big for Claude Code itself (about 25,000 tokens) never reaches the mod: Claude Code saves it to a file of its own and tells Claude where it is, and the mod leaves that alone.

If anything goes wrong (the small model times out after a minute, does not answer, or writes notes no shorter than the original) Claude gets the full result as if the mod were off. At most four hand-offs run at once; a fifth waits a few seconds for a free slot, then goes through whole.

## What it needs

Claude Code 2.1.287 or newer with mods turned on. No outside binary or key; it uses your own Claude account. The private folder for saved results uses `mkdir` and `chmod` under `/tmp`, so on Windows connector results are never handed off and file cards have no detail file.

## Hook events it uses

`session.start`, `session.end`, `prompt.submit`, `command.run` (`/input-router`), `tool.call` (Read, and connector tools `mcp__*`), `tool.check` (Read), `ui.render`.

## What it deletes or stops

It deletes nothing and stops nothing. It replaces a large Read or connector result with short notes plus the path to the full text. Any deny rule you have still wins. The saved full result of a connector sits outside your project, so opening it would normally stop for a permission prompt. The mod lets Claude read it without one, only at the exact path the mod wrote and named to Claude in this chat. Default: off.

## What it sends off the machine

The text of large files and connector results goes to a small model, through Claude Code's own connection and your own account. No other hosts. One request per hand-off, to `claude-haiku-5-5` by name (or `claude-sonnet-5-5` after `/input-router model sonnet`), about 15,000 tokens in and a few hundred out for a 15,000-token file. At Haiku 5.5's list price ($0.10 per million tokens in, $0.50 out) that is about a fifth of a cent. The panel's dollar figures use those list prices (Sonnet 5.5: $2 and $10), so they are estimates, not your bill; check current prices. These requests are not included in Claude Code's own cost display.

It writes to `/tmp/input-router-<your user name>/` (folder readable only by you, each file too): the notes and facts of each hand-off, and the trimmed full text of each connector result. It reads nothing on its own; it sees what the Read tool and connectors already returned.

## How much it saves

Less than "15,000 tokens down to 300" sounds. Claude Code caches what it has already sent, and a cached re-send costs about a tenth of the normal price, so text that stays in the chat is cheap after the first time. One test, with Sonnet as the main model: a four-message chat about a 15,000-token transcript cost about the same with the mod on as with it off once the small model's two cents were added, because Claude went back to the file with `grep` for things the notes left out. What did change was the chat's size: the last message read about a fifth fewer tokens with the mod on. Expect the main gain to be room in the chat, more of it with a pricier main model and with large connector results Claude does not need to see in full.

## Turn it off or uninstall

```
/input-router off
claude plugin uninstall input-router@moka-harness
```

## Known limits

- The small model can miss things. Claude is told the notes are notes and where the original is, but it may answer from notes that left out what mattered. Switch to Sonnet with `/input-router model sonnet` for more careful notes, or turn the mod off for work that needs every line.
- Sizes are estimates (characters divided by 4), not exact token counts.
- Stripping saves little on some connectors. A Google Drive file list shrank about 12%, because most of its fields were filled in; the small model did the rest.
- A file the Read tool already cut short because it was too long is passed through as it is.
- Which connector tools count as reads is guessed from their names. A tool named without a read word is treated as a write: its result goes through whole.
- The last request it uses as "the task" is your last prompt, even for a subagent working on something narrower.

## License

MIT. The connector trimming is adapted from [lean-connector-results](https://github.com/creatorscripts/lean-connector-results) by Creator Scripts (MIT); its copyright notice is kept in LICENSE. The idea comes from Ben AI's video "Copy These 5 Claude Mods, Never Hit a Token Limit Again".
