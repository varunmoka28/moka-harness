# agent-board

Needs [herdr](https://herdr.dev). For people who run several AI agents side by side in herdr tabs: it watches the other tabs, tells you when one finishes or gets stuck, and gives you a `/tabs` command that lists them all.

## What it does

When you have four agent tabs open, you stop noticing which one is waiting for you. A short message appears in your current tab the moment another tab goes from working to done or blocked.

- `/tabs` lists every other agent tab: its state (working, idle, done, blocked), which tool it runs (claude, codex and so on), its name, and how many tokens of context it holds when that is known.
- A message appears for about 15 seconds when another tab goes from working to done or blocked.
- The plugin checks herdr every 30 seconds, so a message can arrive up to half a minute late.
- The tabs are also kept as one line of text that other mods can show; for example cache-clock draws it above the prompt. Without such a mod you still get the messages and `/tabs`.

### Where context sizes come from

- Codex tabs: read from Codex's own session files in `~/.codex/sessions`. This needs `python3`; if it is missing, the size is left out.
- Claude tabs: a tab can publish its size by writing `{ "tokens": 123000, "window": 200000 }` to `/tmp/agent-board-ctx/<pane id>.json`, with each character other than a letter, digit, dot or dash in the pane id replaced by `_`. The context-guard mod does this. Files older than an hour are ignored.
- Other tools: shown without a size.

### Optional: compact idle Codex tabs (off by default)

If you set `AGENT_BOARD_COMPACT=1`, a Codex tab that has been idle or done for 10 minutes with more than 150,000 tokens of context is sent `/compact` once, and you get a message saying so. To turn it on for every Claude Code session, add `"env": { "AGENT_BOARD_COMPACT": "1" }` to your Claude Code settings file. This types into another tab on your behalf, which is why it is off until you ask.

## What it needs

Claude Code 2.1.287 or newer, and [herdr](https://herdr.dev) with the `herdr` command on your PATH. Claude Code must be running inside a herdr tab. Outside herdr, or when herdr does not answer, the plugin does nothing and shows no error. `python3` is optional (Codex context sizes).

Install: `claude plugin install agent-board@moka-harness`.

## Hook events it uses

`session.start`, `command.run` (`/tabs`).

## What it deletes or stops

Nothing is deleted. With `AGENT_BOARD_COMPACT=1` it sends `/compact` to an idle Codex tab, once. Otherwise it only reads.

## What it sends off the machine

Nothing. No network. It runs the `herdr` command (list agents, tabs and panes) and `python3` (read Codex sizes) on your machine, and reads `/tmp/agent-board-ctx` and the newest few files in `~/.codex/sessions`. It writes no files. No model calls of its own; a `/compact` it sends is a normal Codex request in that tab.

## Known limits

- A tab that finishes and starts again inside one 30 second check is not noticed.
- Two Codex tabs in the same folder cannot be told apart: the newest session wins.
- The context-size file location is fixed, and Codex sessions are read from `~/.codex/sessions` even if you moved Codex's home folder.
- Only Codex tabs can be compacted automatically.

## License

MIT
