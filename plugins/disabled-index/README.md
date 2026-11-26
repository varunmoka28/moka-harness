# disabled-index

## What it does

Keeps a short index of the skills inside the plugins you have switched off, and tells Claude when one of them fits your prompt. A disabled plugin costs no context, but its skills are still on disk; when a prompt clearly matches one, Claude gets one line naming the skill's `SKILL.md` to read and follow, without turning the plugin back on.

At session start it reads `enabledPlugins` in `settings.json`, takes every plugin set to `false`, finds its folder in the plugin cache and writes each skill's name and description to the index. On each prompt it compares the prompt's words with the skill names and descriptions, and prints at most two hints. Matching is plain word overlap and needs most of a skill's name in the prompt, so it stays quiet on most prompts and can miss a skill described in other words.

## What it needs

python3. It reads `settings.json` and `plugins/installed_plugins.json` from `CLAUDE_CONFIG_DIR` (or `~/.claude`).

## Hook events it uses

`SessionStart` (builds the index) and `UserPromptSubmit` (prints a hint).

## What it writes

`disabled-plugins.md` in the plugin data folder. It changes no plugin state and never puts the index itself into context.

## What it deletes or stops

Nothing.

## What it sends off the machine

Nothing.
