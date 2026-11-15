# read-fence

A Claude Code mod that stops Claude from opening your skill, rule and plugin folders file by file, while you have the fence switched on.

## What it does

Claude already sees the name and a short description of every skill you have installed. Opening a skill's folder to read its files adds a lot more text to the conversation, and that text is sent again with every later message. The fence keeps Claude from doing that by accident.

Example: you ask Claude to "look at what skills I have". Without the fence it may open dozens of skill files. With the fence on, it is told to use the list it already has, and to run a skill with the Skill tool when it needs one.

## Install

Paste these two lines into a terminal (not into Claude):

```
claude plugin marketplace add varunmoka28/moka-harness
claude plugin install read-fence@moka-harness
```

## How to use

One command, inside Claude Code:

- `/read-fence on` switches the fence on.
- `/read-fence off` switches it off.
- `/read-fence status` (or just `/read-fence`) tells you whether it is on.

The fence starts off.

While it is on, Claude's Read, Glob, Grep and Bash tools are refused when they point at:

- the `skills`, `rules` and `plugins/cache` folders inside your Claude config folder (`~/.claude`, or the folder named by `CLAUDE_CONFIG_DIR`)
- the `.claude/skills` and `.claude/rules` folders of the project you are working in

These are always allowed, even with the fence on:

- the folder of a skill Claude has just run
- any file called `CLAUDE.md`
- the memory folders inside your Claude config folder

## Options

Set these in `/config`, or in `settings.json` under `pluginConfigs`:

- `configDirs`: config folders to fence, comma-separated (`~/.claude, ~/.claude-work`). The first one keeps the on/off switch, so two accounts given the same list share one switch. Empty means this account's folder only.
- `exempt`: folders that stay readable with the fence on, comma-separated (`~/my-mods`).

## What it needs

Claude Code 2.1.287 or newer (mods are on by default from that version). Works on macOS and Linux. Windows paths are not handled, so the fence will not block anything there. It reads the environment variables `CLAUDE_CONFIG_DIR` and `HOME`. No outside binary or key.

## Hook events it uses

`session.start`, `command.run` (`/read-fence`), `skill.prompt`, `tool.call` (Read, Glob, Grep, Bash).

## What it deletes or stops

It deletes nothing. While the fence is on it refuses Read, Glob, Grep and Bash calls that point at the fenced folders, and says why. It writes one small switch file, `read-fence.json`, in the first config folder, only when you run `/read-fence on` or `/read-fence off`. Off by default.

## What it sends off the machine

Nothing. No network and no model calls.

## Turn it off / uninstall

Switch the fence off with `/read-fence off`, or remove the mod:

```
claude plugin uninstall read-fence@moka-harness
```

You can delete `read-fence.json` from your Claude config folder afterwards.

## Known limits

- It reads the paths written in the tool call. A Bash command that builds a folder name from other commands or variables (other than `$HOME`) or uses a path relative to the current folder can get past it.
- Folders are checked as written and after symbolic links are followed, but a Bash command that changes folder first and then uses a short path is not caught.
- The switch is one file per Claude config folder. If you use more than one config folder, switch each one separately, or give them the same `configDirs` list.
- If the fence cannot work something out, it lets the call through rather than blocking your work.

## License

MIT
