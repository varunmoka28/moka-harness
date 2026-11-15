# idea-shelf

Park an idea without interrupting Claude.

## What it does

`/idea <text>` shelves an idea in a store that is shared across projects. `/ideas` lists them, and you can send one to Claude later or remove it. Older store keys from earlier versions are migrated into the current one the first time it runs.

## What it needs

Claude Code with plugin mods support. Nothing else.

## Hook events it uses

`session.start`, `command.run` (`/idea`, `/ideas`), `ui.render`.

## What it deletes or stops

It deletes an idea only when you remove it from the list, and it deletes the older store keys after copying them into the current one. It touches nothing outside its own store.

## What it sends off the machine

Nothing. No network.
