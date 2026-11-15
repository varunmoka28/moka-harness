# multi-agent

Tools for running several agents side by side and handing work between them. Needs herdr and tuios installed; Codex and agy are optional; dispatch-router needs a TypeSafe key.

## Members

- `agent-board`: Keeps an eye on your other herdr agent tabs: shows their state and context size, pops a message when one finishes or gets stuck, and adds /tabs. Needs herdr and Claude Code 2.1.287 or newer; does nothing outside herdr.
- `tab-namer`: Names your herdr tab and its workspace after the task you give Claude, from your first prompt. Can also rename it as the work changes, if you turn that on. Needs herdr and Claude Code 2.1.287 or newer; sends your first prompt to Haiku only if relabelling is on.
- `dispatch-router`: Asks a TypeSafe model which CLI and model should take each agent task and refuses unrouted launches. Needs a TypeSafe API key; without one it does nothing. Sends task text to api.typesafe.ai.
- `multi-agent-kit`: A skill on splitting work between agents, plus hooks for tuios users (window list, window reaper that starts in dry-run). Each hook does nothing when its tool is missing.
- `codex`: Use OpenAI Codex from Claude Code to review code or hand off tasks. Needs Node 18.18 or newer, the Codex CLI and a ChatGPT account or OpenAI API key.
- `session-board`: A floating board of running Claude Code sessions, with a jump to the tmux window of the one you pick. Needs tmux.

## What it needs

Needs herdr and tuios installed; Codex and agy are optional; dispatch-router needs a TypeSafe key.

## MCP servers

- `claude-peers`: Peer messaging between Claude Code sessions. Runs from your clone of louislva/claude-peers-mcp (MIT) at commit fc2649154d6c5aa94ae4fc766989d7f247be0617, with bun.
- `kanzo`: Kanban board over MCP. Needs the `kanzo` binary on your PATH, version 0.3.0.

Secrets are asked for when you enable the plugin and are never written to this repository.
