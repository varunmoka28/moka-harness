# prompt-enhancer

Adds an Enhance button above the prompt box. It rewrites a rough request into a clearer prompt, in place, and you read and edit the result before sending. **It needs a TypeSafe API key, and the calls it makes are paid.**

## What it does

Press Enhance (hotkey `e` from the band, or `ctrl+x` then `e`). The mod gathers your draft, your last three prompts, Claude's last reply, and your project rules (`CLAUDE.md`, `AGENTS.md` up the folder tree, and `.claude/rules/*.md`, cut at 15,000 characters). It asks Jev which of your installed skills fit the draft, then asks a Haiku model to write the prompt, with the fitting skills named, decisions for you to make, and a "Done means" line. Undo restores your draft. Send submits the result.

Without a TypeSafe key it does nothing, and says so once per session.

## What it needs

- Claude Code with mods (the `claude-code` plugin API).
- `python3` on the path, for the bundled `hooks/jev-skill-router.py`.
- A TypeSafe API key, set as the `TYPESAFE_API_KEY` plugin setting (stored as a sensitive value) or in the `TYPESAFE_API_KEY` environment variable. No `.env` file is read.

## Hook events it uses

`prompt.submit` and `turn.complete` (to remember recent prompts and the last reply), `ui.render` (the band above the prompt), and the `prompt`, `process`, `fs`, `env` and `model` calls inside Enhance.

## What it deletes or stops

Nothing. Enhance replaces the text in the prompt box, and Undo puts your draft back. Nothing on disk is deleted. The router writes token counts (never prompt text) to `jev-router-usage.jsonl` in `${CLAUDE_PLUGIN_DATA}`.

## What it sends off the machine

Only when you press Enhance, and only with a key set:

- To `api.typesafe.ai` (Jev, paid per request): your draft prompt (first 4,000 characters) and the name and description of up to about 24 of your installed skills (the best keyword matches plus a few always-checked ones). One request per press. The router reads skill files under your Claude config folder and the project's `.claude` folder.
- To a Claude model (Haiku, through your own Claude Code session, so it counts against your plan or API use): the draft, the working folder path, recent prompts, the last reply, the project rules text, and the skills Jev ranked.

Slash commands, harness messages and prompts under four words are not sent to Jev.
