# collision-guard

Asks before Claude edits a file that something else changed in the last 30 minutes, so two Claude sessions do not overwrite each other's work.

## What it does

When Claude is about to use Edit, Write or NotebookEdit on a file, the mod checks the file's modified time. If the file changed within the last 30 minutes and this session did not make that change, it asks "Edit it anyway?" with Proceed or Cancel. Cancel refuses the edit and tells Claude why. A file this session wrote itself is only flagged again if its modified time later differs from what this session left. If the check itself fails, the edit goes ahead as normal.

## What it needs

Claude Code with mods enabled. No outside binary or key. It optionally reads the `unattended` mod's on/off state; if that mod is not installed the state is simply off.

## Hook events it uses

`session.start`, `tool.call` (Edit, Write, NotebookEdit).

## What it deletes or stops

It deletes nothing. It can stop one edit: choosing Cancel denies that single tool call. When the `unattended` mod is on, nobody is asked; the edit proceeds and a note is added to the tool result.

## What it sends off the machine

Nothing. No network and no model calls.

## Install

```
claude plugin marketplace add varunmoka28/moka-harness
claude plugin install collision-guard@moka-harness
```

## License

MIT.
