# core-bundle

The everyday set: working-style rules, guard hooks, session mods, and general-purpose skills. Needs nothing beyond Claude Code, python3, git and jq; a few mods are macOS only.

## Members

- `core`: Working-style rules, guard hooks and the doctor skill.
- `assumption-log`: Claude logs each guess it makes about what you want into a side panel. Needs Claude Code 2.1.287 or newer; tested on macOS.
- `collision-guard`: Asks before Claude edits a file that something else changed in the last 30 minutes. Needs nothing; reads the unattended plugin's state if present.
- `context-guard`: Warns when the conversation context gets large; opt-in auto-compact of idle sessions. Needs nothing.
- `cache-clock`: Countdown above the prompt for the prompt cache, with a compact button. Needs the unattended and layman plugins (installed as dependencies).
- `image-shrinker`: Shrinks big images before Claude reads them. macOS only: needs sips.
- `input-router`: Hands large file reads and connector results to a small model first. Off by default; sends the text to a model through your own account.
- `read-fence`: Stops Claude from opening your skill, rule and plugin folders file by file while switched on. Off by default; macOS and Linux.
- `skills-az`: Lists your slash commands and skills A to Z when you type /. Needs Claude Code 2.1.287 or newer; tested on macOS.
- `disabled-index`: Hints when a skill inside a plugin you switched off fits your prompt. Needs python3.
- `next-steps-autopilot`: A What next? button above the prompt box asks for suggested next prompts only when pressed. Type /auto to have suggestion 1 sent after a countdown you set; off by default. Needs Claude Code 2.1.287 or newer. Built on Thariq Shihipar's next-steps (MIT).
- `unattended`: Stops a Claude Code session from asking you questions when nobody is at the keyboard. Type /unattended, or launch with CLAUDE_UNATTENDED=1. Needs Claude Code 2.1.287 or newer.
- `park`: Save this Claude Code session and write a note for the next one. If you use herdr, /park also asks your other agent tabs to save, and can close them. /unpark picks the note up. Needs Claude Code 2.1.287 or newer. herdr optional: with it, /park also saves and /park close closes other agent tabs.
- `disk-sweep`: macOS only. Warns when your Mac is low on disk space and, with /disk, lists old Claude Code leftovers you can tick and delete. Starts in dry-run mode: it deletes nothing until you turn dryRun off and list a folder in deleteRoots.
- `clean-view`: Hides tool calls, diffs and command output and shows a plain checklist above the prompt. Needs nothing else; sends a short text to Haiku to name the checklist.
- `idea-shelf`: Park ideas with /idea and send them to Claude later. Needs nothing else.
- `noticeboard`: A /board side pane that explains the question at the end of a reply with explorable options. Needs the claude command; herdr is optional.
- `band-frame`: A top rule and tinted background around the band above the prompt. Needs nothing else.
- `session-peers`: Records each Claude session in a folder for a pane such as terminal-desk, and warns when two edit the same file. Useful with terminal-desk.
- `strict-guard`: Allows harmless destructive shell commands and refuses the rest by fixed rules, without asking. Needs git and bash. Apache-2.0.
- `terminal-desk`: Stats bar above the prompt and a /desk pane. Needs Claude Code 2.1.287 or later; herdr optional. Optional second-model check sends your request and Claude's final report to Haiku.
- `side-chat`: A side pane for follow-up questions (/btw). macOS only. Sends your question and the main conversation to a model fork; falls back to Haiku.
- `layman`: Plain-language replies on request. No dependencies; makes no model or network calls.
- `big-read-guard`: Refuses whole-file Reads of text files over 50 KB. Needs awk.
- `superpowers`: Skills for test-driven development, debugging and planning work in steps. Needs nothing.
- `ponytail`: Pushes Claude toward the shortest solution that works, with review and audit commands. Needs nothing.
- `scope-guard`: Counts the files a turn edits and stops at a threshold so you restate the goal. Needs Claude Code 2.1.287 or newer.
- `smart-compact`: Compacts at a good moment: after a commit or green tests, or just before the prompt cache expires. Needs Claude Code 2.1.295 or newer.
- `micro-compaction`: Adds /compact micro, which drops old file reads and thinking from the transcript without a model summary. Needs Claude Code 2.1.287 or newer.
- `cache-tax`: Keeps the one-hour prompt cache warm during breaks and warns once before a cold send. Warming sends model requests that cost tokens. Needs Claude Code 2.1.287 or newer.
- `secret-box`: Lets Claude use a secret without seeing it: you paste the key in a masked box and Claude gets a placeholder. Needs Claude Code 2.1.287 or newer.
- `modwall`: Shows what each mod can reach as it loads and holds or refuses it by your policy. Needs Claude Code 2.1.287 or newer.
- `claude-code-setup`: Reads a codebase and recommends hooks, skills, MCP servers and subagents for it. Needs nothing.
- `mod-scout`: Ranks the mods you would use most from your recent sessions, with a skill that designs them. Needs Claude Code 2.1.287 or newer and Node 18 or newer.
- `clawd-spinner`: Animated spinner for the Claude Code terminal. Needs nothing extra.
- `unlazy`: Completion discipline for long tasks: write the checks first, then verify before reporting.
- `pocock-skills`: Matt Pocock's engineering skills: grilling, domain modelling, bug diagnosis, writing for agents. The plugin loads the author's whole set.
- `debug-agent`: Debugging from runtime evidence: adds logging, guides reproduction and cites log lines to prove the root cause.
- `health`: Audits a Claude Code setup: instruction drift, hooks, MCP servers and config layers.
- `tare`: Finds where Claude Code usage went, from the session logs already on disk.

## What it needs

Needs nothing beyond Claude Code, python3, git and jq; a few mods are macOS only.

## MCP servers

- `context7`: Context7 documentation lookup, pinned to `@upstash/context7-mcp` 4.7.0. Runs through npx.

Secrets are asked for when you enable the plugin and are never written to this repository.
