# dispatch-router

Asks a TypeSafe model which CLI and model should take each agent task, then refuses an agent launch that was not routed.

## What it does

Claude gets a tool, `mcp__dispatch-router__route`. Before starting an agent (a terminal tab, an Agent tool call, optionally a cloud session), Claude passes the task text. A TypeSafe model picks the cheapest runner that fits (a Claude model tier, Codex, or agy) and the tool returns the exact launch command and the files the brief must point at.

After that the plugin checks launches. A `claude`, `codex` or `agy` command (also when typed into a pane with `herdr pane run` or `send-keys`), or an Agent tool call, is refused unless a routed decision matches it: the same CLI, the same model, launched within 30 minutes. A decision is used once. Forks, `claude plugin ...`, `agy models` and similar non-session commands pass.

`/dispatch-router off` switches the router off for the current session: no launch is checked and `route` asks nothing. `/dispatch-router on` turns it back on, and every new session starts with it on.

With no key, it does nothing and shows one notice at session start.

## What it needs

- A TypeSafe API key, set as the `typesafeApiKey` option (stored as a sensitive value) or as `TYPESAFE_API_KEY` in the environment. No `.env` file is read.
- Claude Code with plugin hooks modules (the same as the other mods here).
- Optional: the `codex` and `agy` CLIs, if you list them under `runners`. The default is `claude` only.

Options:

| Option | Default | Use |
|---|---|---|
| `runners` | `claude` | Which CLIs to route between: `claude`, `codex`, `agy` |
| `claudeModelLow` / `Mid` / `High` | `haiku` / `sonnet` / `opus` | Model names for the three Claude tiers |
| `codexModel` | empty | Model for `codex -m`; empty matches on the command alone |
| `agyModelLow` / `agyModelHigh` | empty | Models for `agy --model`; empty matches on the command alone |
| `claudeFlags`, `codexFlags`, `agyFlags` | empty | Extra flags appended to the launch command shown to you |
| `briefFiles` | `AGENTS.md` | Files Codex and agy launches must be pointed at, since they do not load `CLAUDE.md` |
| `allowCloud` | off | Lets the model send a Claude task to a `claude --cloud` session |
| `localOnlyPattern` | `\.env\b\|\blfs\b\|/tmp/` | Regular expression; a task or path that matches it never goes to the cloud |

## Hook events it uses

- `session.start`: registers the `route` tool (or shows the no-key notice).
- `tool.call` on `mcp__dispatch-router__route`: asks the model and records the decision.
- `tool.call` on `Bash`: checks agent launches.
- `tool.call` on `Agent`: checks the model of each Agent call.

## What it deletes or stops

It deletes nothing. It refuses (denies) an unrouted agent launch; that refusal is the point of the plugin. Remove the plugin to stop it.

## What it sends off the machine

The task text (first 4,000 characters), any paths and local needs you pass to `route`, and the list of runner descriptions go to `api.typesafe.ai` with your key. Nothing else is sent. A local log line per routing (runner, confidence, place, token count; no task text) is appended to `dispatch-router.log.jsonl` under `CLAUDE_PLUGIN_DATA`.
