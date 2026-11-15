# session-peers

Records which Claude sessions are open in a folder.

## What it does

Writes one small JSON file per session (working, waiting or done, and the files it edited) so a pane such as terminal-desk can list them. When another session in the same folder has also edited a file, it adds a line to Claude's context so the overlap is mentioned.

The files live in `$CLAUDE_CONFIG_DIR/session-peers/<folder>`, or `~/.claude/session-peers/<folder>` when `CLAUDE_CONFIG_DIR` is not set.

## What it needs

Claude Code with plugin mods support. It is useful with terminal-desk, which reads these files. `HERDR_TAB_ID` is recorded if it is set.

## Hook events it uses

`session.start`, `session.end`, `turn.start`, `turn.complete`, `tool.call`, `tool.check`, and a 30 second timer.

## What it deletes or stops

It removes its own record when a session ends, and when `/clear` changes the session id, and it removes records of sessions that stopped updating. It does not touch other files.

## What it sends off the machine

Nothing. No network.
