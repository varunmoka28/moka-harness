# assumption-log

Claude writes down each guess it makes about what you want, and the guesses appear in a side panel as they happen.

## What it does

You ask Claude to "clean up the repo". It decides you mean the frontend folder and starts deleting files. With this mod, "I took 'the repo' to mean the frontend folder" shows up in the panel (and as a short pop-up) before the work happens, so you can stop it early instead of finding out at the end. If Claude later changes its mind, the new entry replaces the old one, and the old one is crossed out.

## Install

```
claude plugin marketplace add varunmoka28/moka-harness
claude plugin install assumption-log@moka-harness
```

## How to use

- `/assumptions` opens the panel. Entries are numbered A1, A2, and so on, newest at the top. The five newest are shown.
- `/assumptions close` closes it (so does `q` or Esc inside the panel).
- `/assumptions clear` empties the list. Numbers keep counting up, so A2 never means two different things.
- In the panel, "Reject" on an entry types a correction into your prompt box ("Assumption A3 is wrong ... Instead:"). Nothing is sent until you press Enter.
- A replaced entry is crossed out and says which entry replaced it. A rejected one says "you rejected it".

You do not have to do anything for Claude to log guesses. The mod adds a short note to Claude's instructions that asks it to record judgment calls you did not state (which of two readings of your request it took, what it treated as in or out of scope, what it took "done" to mean). Claude decides what counts, so a small task may log nothing.

## What it needs

Claude Code 2.1.287 or newer with mods enabled. Tested in the terminal on macOS. It has not been tried in the desktop app or on Windows. No outside binary or key.

## Hook events it uses

`session.start`, `session.end`, `command.run` (`/assumptions`), `prompt.compose`, `tool.call`, `ui.render`. It registers one tool, `note_assumption`. On by default once installed. The panel stays closed until you run `/assumptions`; a pop-up shows each new guess. The mod adds a short note (about 150 words) to Claude's instructions.

## What it deletes or stops

Nothing. No files are read or written; the list lives in memory only.

## What it sends off the machine

Nothing. The mod makes no network calls and no model calls of its own. Each logged guess is one small tool call in your normal conversation.

The list belongs to the current conversation. It is not saved when you quit, and it is emptied by `/clear` and `/resume`, because Claude no longer remembers the earlier guesses either. Guesses made by subagents go into the same list, marked "subagent".

## Turn it off / uninstall

```
claude plugin disable assumption-log
claude plugin uninstall assumption-log
```

## Known limits

- Claude writes the entries, so it can miss a guess or word one badly. The panel shows what Claude reported, not everything it assumed.
- Only the 30 most recent entries are kept, and the panel shows the five newest.
- Not saved across restarts.

## License

MIT. The assumptions feature was adapted from the Terminal Desk mod by ClariSortAi (also MIT) and reworked. Both copyright lines are in `LICENSE`.
