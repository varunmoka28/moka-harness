# strict-guard

Decides destructive shell commands by fixed rules, and never asks.

## What it does

Checks every `rm`, `git reset --hard`, `git clean`, force push and migration command in a Bash call. It allows the harmless ones (a temporary folder, a build leftover, nothing discarded, no commits dropped) and refuses the rest. It never runs the guarded command and never asks you. A refusal goes back to Claude with the reason and a request to ask you instead.

This is a text check on the command line, not a sandbox: it cannot see what a shell alias, a function, a variable used as a command name, a script it calls, or another interpreter (`python -c`, `su -c`, `busybox rm`) would delete, so treat it as a safety net for mistakes, not a security boundary.

## What it needs

Claude Code with plugin mods support, `git`, and `bash`. It runs `realpath`, `git status`, `git clean -n` and `git log` to measure, and nothing else.

## Hook events it uses

`tool.call` on Bash.

## What it deletes or stops

Nothing. It only refuses; it never runs or deletes anything itself.

## What it sends off the machine

Nothing. No network.

## Licence

Apache-2.0, see `LICENSE`. Adapted from Blast Radius in anthropics/claude-code-playground; see `NOTICE`.
