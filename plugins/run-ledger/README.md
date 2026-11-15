# run-ledger

A pane that lists the estimated API cost of each run, by model and by the plugin that made the call, shows each subagent's status, and can ask Jev which model a subagent should use. **Jev advice needs a TypeSafe API key, and those calls are paid.** The cost figures are estimates at list prices, not a bill.

## What it does

Open the pane with `/run-ledger`. It keeps the last 40 runs of the session: requests, tokens, retries, estimated cost, and each subagent with its status and last action. `/run-ledger export` writes the ledger to a JSON file in your Claude config folder.

The setting `mode` controls Jev:

- `off` (default): Jev is never called. The pane still works.
- `recommend`: before each subagent starts, Jev recommends a model, and the pane shows it beside the model that ran.
- `auto-route`: the same, and a subagent started with no model named runs on Jev's pick when Jev is confident.

With a mode other than `off` and no key, the mod says so once and does nothing more. Subagents start as normal.

## What it needs

- Claude Code with mods (the `claude-code` plugin API).
- For `recommend` or `auto-route`: a TypeSafe API key, set as the `TYPESAFE_API_KEY` plugin setting (stored as a sensitive value) or in the `TYPESAFE_API_KEY` environment variable. No `.env` file is read.
- Settings: `mode` (default `off`), `budgetUsd` (default 1, handed to Jev with the task).

## Hook events it uses

`session.start`, `command.run`, `agent.spawn`, `http.fetch` and `model.complete` (to count other plugins' calls), `model.classify`, `model.fork`, `session.append` (retry notices), `tool.call`, `turn.start`, `turn.step`, `turn.complete`, and `ui.render` for the pane.

## What it deletes or stops

Nothing. In `auto-route` mode it can change which model a subagent runs on, only when the call named none and Jev is confident. A subagent that has shown no activity for 10 minutes is marked ended in the pane; nothing is killed.

## What it sends off the machine

Only when `mode` is not `off`, a key is set, and a subagent is about to start (forks are skipped). One request per subagent to `api.typesafe.ai` (Jev, paid per request) with: the subagent's task text (first 4,000 characters), its agent type, the budget, the list prices of the candidate models, and up to eight past results of that agent type (model, outcome, cost, token count). Nothing is sent in `off` mode. The export file stays on your machine.
