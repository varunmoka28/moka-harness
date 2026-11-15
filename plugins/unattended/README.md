<p align="center">
  <img src="assets/banner.svg" alt="unattended: No questions while nobody is at the keyboard." width="100%">
</p>

## What it does

Stops a session from asking you questions when nobody is at the keyboard. When it is on, Claude's question prompts and plan mode are refused with a note telling Claude to pick the most sensible option itself and carry on.

Example: you ask Claude to clean up a folder and go for lunch. Claude would normally stop and ask which of two naming styles to use. With this mod on, it picks one, tells you which and why in its reply, and keeps going.

- `/unattended` flips the mode on or off. `/unattended on` and `/unattended off` set it.
- To start a session already on, launch with `CLAUDE_UNATTENDED=1`, for example `CLAUDE_UNATTENDED=1 claude`.
- Off by default; applies to the current session only.

## What it needs

Claude Code 2.1.287 or newer. No outside tool, key or binary. Install: `claude plugin install unattended@moka-harness`.

## Hook events it uses

`session.start`, `command.run` (`/unattended`), and `tool.call` on `AskUserQuestion` and `EnterPlanMode`.

## What it deletes or stops

Nothing is deleted. While on, it refuses the `AskUserQuestion` and `EnterPlanMode` tools. Permission prompts for other tools are not touched.

## What it sends off the machine

Nothing. No network, no files read or written, no model calls of its own. Claude keeps working instead of waiting, so the session may use more tokens than if it had stopped to ask.

## Known limits

- If you launch Claude in plan mode, it still starts there. The mod only stops Claude from entering plan mode on its own.
- Claude picks the default itself, so check its reply to see which choice it made.

## License

MIT
