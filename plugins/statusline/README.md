# statusline

A status line that redraws the output of [claude-hud](https://github.com/jarrodwatts/claude-hud) as coloured segments (model, folder, branch, time), with the dim config counts on the right. Each segment has its own background, so the line is easy to tell apart from the conversation above it.

## What it does

`statusline.sh` runs claude-hud with bun and pipes the result through `statusline.py`, which splits it into segments and fits it to the terminal width. Text it does not recognise passes through unchanged.

## What it needs

The claude-hud plugin, which this marketplace lists as `hud` because Claude Code reserves names starting with `claude-` (installed with this one), `bun`, `python3`.

## Turn it on

A plugin cannot edit your `settings.json`, so you add the line yourself. Find the script, then set `statusLine` to run it:

```
ls ~/.claude/plugins/cache/moka-harness/statusline/*/statusline.sh
```

```json
"statusLine": { "type": "command", "command": "bash <that path>" }
```

Re-do this after an update, because the folder name holds the version.

## Hook events it uses

None. Claude Code calls the script itself.

## What it deletes or stops

Nothing.

## What it sends off the machine

Nothing from these scripts. claude-hud reads your local session data and does not use the network as far as its README says; this was not checked.
