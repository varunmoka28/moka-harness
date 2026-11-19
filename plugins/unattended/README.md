<p align="center">
  <img src="assets/banner.svg" alt="unattended: No questions while nobody is at the keyboard." width="100%">
</p>

## What it does

Stops a session from asking you questions when nobody is at the keyboard. When it is on, Claude's question prompts and plan mode are refused with a note telling Claude to pick the most sensible option itself and carry on.

Example: you ask Claude to clean up a folder and go for lunch. Claude would normally stop and ask which of two naming styles to use. With this mod on, it picks one, tells you which and why in its reply, and keeps going.

- `/unattended` flips the mode on or off. `/unattended on` and `/unattended off` set it.
- To start a session already on, launch with `CLAUDE_UNATTENDED=1`, for example `CLAUDE_UNATTENDED=1 claude`.
- Off by default; applies to the current session only.

### Route mode, for worker agents

A worker agent in a tuios window should not guess: the orchestrator has context it lacks. In route mode a refused question goes into the worker's task file instead of being dropped.

- `/unattended route`, or launch with `CLAUDE_UNATTENDED=route` and `CLAUDE_TASK_FILE=<path to the task file>`.
- When Claude asks a question, the mod appends a `STATUS: blocked` line to the task file, then one `QUESTION:` line per question with the options Claude was going to offer. Claude is told to carry on with any part of the task that does not depend on the answer, or stop if nothing does.
- `tuios-worker-watch.sh` in `multi-agent-kit` already wakes the orchestrator on a new `STATUS: blocked` line. The orchestrator answers with `tuios-send-verified.sh`, or asks you when the decision is yours.
- If `CLAUDE_TASK_FILE` is unset, or the file cannot be written, the mod falls back to on mode (Claude picks and carries on) and says why in the refusal, so a worker is never left stuck.
- Plan mode is refused in route mode just as in on mode.

Example task file after a refused question:

```
STATUS: blocked
QUESTION: Which naming style should the new files use? Options: kebab-case | snake_case
```

## What it needs

Claude Code 2.1.287 or newer. No outside tool, key or binary. Install: `claude plugin install unattended@moka-harness`.

## Hook events it uses

`session.start`, `command.run` (`/unattended`), and `tool.call` on `AskUserQuestion` and `EnterPlanMode`. Route mode reads the `CLAUDE_TASK_FILE` environment variable.

## What it deletes or stops

Nothing is deleted. In route mode it rewrites the task file with the blocked lines added at the end; the rest of the file is kept as it was. While on, it refuses the `AskUserQuestion` and `EnterPlanMode` tools. Permission prompts for other tools are not touched.

## What it sends off the machine

Nothing. No network and no model calls of its own. In on mode no files are read or written; in route mode it reads and writes the one file named by `CLAUDE_TASK_FILE`. Claude keeps working instead of waiting, so the session may use more tokens than if it had stopped to ask.

## Known limits

- If you launch Claude in plan mode, it still starts there. The mod only stops Claude from entering plan mode on its own.
- Claude picks the default itself, so check its reply to see which choice it made.

## License

MIT
