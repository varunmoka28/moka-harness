# Group: multi-agent

Running several agents side by side and handing work between them.

Install: `claude plugin install multi-agent@moka-harness`

To install less, install single members by name, for example `claude plugin install agent-board@moka-harness`.

## Needs

herdr and tuios installed; Codex and agy are optional; `dispatch-router` needs a TypeSafe key.

The bundle also carries these MCP servers, started when the bundle is enabled:

- `claude-peers`: bun ${user_config.claude_peers_dir}/server.ts
- `kanzo`: kanzo mcp

## Members

| Member | What it is | Needs | Rough context cost |
|---|---|---|---|
| `agent-board` | Keeps an eye on your other herdr agent tabs: shows their state and context size, pops a message when one finishes or gets stuck, and adds /tabs. Needs herdr and Claude Code 2.1.287 or newer; does nothing outside herdr. | herdr | no always-on text found in its hooks |
| `tab-namer` | Names your herdr tab and its workspace after the task you give Claude, from your first prompt. Can also rename it as the work changes, if you turn that on. Needs herdr and Claude Code 2.1.287 or newer; sends your first prompt to Haiku only if relabelling is on. | herdr | no always-on text found in its hooks |
| `dispatch-router` | Asks a TypeSafe model which CLI and model should take each agent task and refuses unrouted launches. Needs a TypeSafe API key; without one it does nothing. Sends task text to api.typesafe.ai. | TypeSafe key | no always-on text found in its hooks |
| `multi-agent-kit` | A skill on splitting work between agents, plus hooks for tuios users (window list, window reaper that starts in dry-run). Each hook does nothing when its tool is missing. | tuios and jq; macOS for the reaper | skill description: 29 words |
| `codex` | Use OpenAI Codex from Claude Code to review code or hand off tasks. Needs Node 18.18 or newer, the Codex CLI and a ChatGPT account or OpenAI API key. | Codex CLI | 3 skills, 43 words of descriptions; plus hook text not counted |
| `session-board` | A floating board of running Claude Code sessions, with a jump to the tmux window of the one you pick. Needs tmux. | See author repo | hook text not counted |

## Rough context cost

Counted words added to every session by the members above: about 72. This is the sum of skill description words and the session-start text that could be counted. It is a rough guide in words, not a measurement of tokens; tokens run somewhat higher than words.
2 members in this group have text that was not counted: hooks that add session text, or skills whose descriptions were not read. Harness mods add text for the model only where a figure appears above, plus short instructions some add when you trigger them.
Skill descriptions are what load at every session start. The body of a skill loads only when it is used. Third-party description counts come from the SKILL.md at the pinned commit.
