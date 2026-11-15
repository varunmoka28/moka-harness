# clean-view

A quieter Claude Code window.

## What it does

Hides tool calls, diffs and command output while Claude works, and shows a plain checklist above the prompt. `/simple` turns it on and off. It registers two tools, `plan_steps` and `report_progress`, so Claude can fill the checklist.

## What it needs

Claude Code with plugin mods support. Nothing else.

## Hook events it uses

`session.start`, `command.run` (`/simple`), `prompt.compose`, `prompt.submit`, `tool.call`, `turn.start`, `turn.complete`, and `ui.render` on the above-prompt band and the tool group, progress and result areas.

## What it deletes or stops

Nothing. It hides output in the pane only; the output is still produced.

## What it sends off the machine

A short piece of text is sent to the Haiku model through Claude Code to name the checklist. Nothing else leaves the machine.
