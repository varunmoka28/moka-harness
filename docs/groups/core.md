# Group: core

Working-style rules, guard hooks, session mods and general-purpose skills. This is the everyday set.

Install: `claude plugin install core-bundle@moka-harness`

To install less, install `core` alone, or any single member by name, for example `claude plugin install collision-guard@moka-harness`.

## Needs

Nothing beyond Claude Code. python3, git and jq for the guard hooks and `doctor`; a few mods are macOS only.

The bundle also carries these MCP servers, started when the bundle is enabled:

- `context7`: npx -y @upstash/context7-mcp@4.7.0

## Members

| Member | What it is | Needs | Rough context cost |
|---|---|---|---|
| `core` | Working-style rules for Claude Code, loaded into each session by a SessionStart hook, plus guard hooks that start in dry-run. | python3, bash, git, jq | skill description: 26 words; working-style.md printed at session start: 1,489 words |
| `assumption-log` | Claude logs each guess it makes about what you want into a side panel. Needs Claude Code 2.1.287 or newer; tested on macOS. |  | about 150 words added to the instructions (its README) |
| `collision-guard` | Asks before Claude edits a file that something else changed in the last 30 minutes. Needs nothing; reads the unattended plugin's state if present. |  | no always-on text found in its hooks |
| `context-guard` | Warns when the conversation context gets large; opt-in auto-compact of idle sessions. Needs nothing. |  | no always-on text found in its hooks |
| `cache-clock` | Countdown above the prompt for the prompt cache, with a compact button. Needs the unattended and layman plugins (installed as dependencies). |  | no always-on text found in its hooks |
| `image-shrinker` | Shrinks big images before Claude reads them. macOS only: needs sips. | macOS only | no always-on text found in its hooks |
| `input-router` | Hands large file reads and connector results to a small model first. Off by default; sends the text to a model through your own account. | Nothing; off by default | no always-on text found in its hooks |
| `read-fence` | Stops Claude from opening your skill, rule and plugin folders file by file while switched on. Off by default; macOS and Linux. | Nothing; off by default | no always-on text found in its hooks |
| `skills-az` | Lists your slash commands and skills A to Z when you type /. Needs Claude Code 2.1.287 or newer; tested on macOS. |  | no always-on text found in its hooks |
| `next-steps-autopilot` | A What next? button above the prompt box asks for suggested next prompts only when pressed. Type /auto to have suggestion 1 sent after a countdown you set; off by default. Needs Claude Code 2.1.287 or newer. Built on Thariq Shihipar's next-steps (MIT). |  | no always-on text found in its hooks |
| `unattended` | Stops a Claude Code session from asking you questions when nobody is at the keyboard. Type /unattended, or launch with CLAUDE_UNATTENDED=1. Needs Claude Code 2.1.287 or newer. |  | no always-on text found in its hooks |
| `park` | Save this Claude Code session and write a note for the next one. If you use herdr, /park also asks your other agent tabs to save, and can close them. /unpark picks the note up. Needs Claude Code 2.1.287 or newer. herdr optional: with it, /park also saves and /park close closes other agent tabs. | herdr optional | no always-on text found in its hooks |
| `disk-sweep` | macOS only. Warns when your Mac is low on disk space and, with /disk, lists old Claude Code leftovers you can tick and delete. Starts in dry-run mode: it deletes nothing until you turn dryRun off and list a folder in deleteRoots. | macOS only; deletes only after setup | no always-on text found in its hooks |
| `clean-view` | Hides tool calls, diffs and command output and shows a plain checklist above the prompt. Needs nothing else; sends a short text to Haiku to name the checklist. |  | a 111-word plan rule, only while /simple is on |
| `idea-shelf` | Park ideas with /idea and send them to Claude later. Needs nothing else. |  | no always-on text found in its hooks |
| `noticeboard` | A /board side pane that explains the question at the end of a reply with explorable options. Needs the claude command; herdr is optional. |  | no always-on text found in its hooks |
| `band-frame` | A top rule and tinted background around the band above the prompt. Needs nothing else. |  | no always-on text found in its hooks |
| `session-peers` | Records each Claude session in a folder for a pane such as terminal-desk, and warns when two edit the same file. Useful with terminal-desk. |  | no always-on text found in its hooks |
| `strict-guard` | Allows harmless destructive shell commands and refuses the rest by fixed rules, without asking. Needs git and bash. Apache-2.0. | git, bash | no always-on text found in its hooks |
| `terminal-desk` | Stats bar above the prompt and a /desk pane. Needs Claude Code 2.1.287 or later; herdr optional. Optional second-model check sends your request and Claude's final report to Haiku. |  | about 200 tokens added to the system prompt for the assumptions panel (its README) |
| `side-chat` | A side pane for follow-up questions (/btw). macOS only. Sends your question and the main conversation to a model fork; falls back to Haiku. | macOS (copy action) | no always-on text found in its hooks |
| `layman` | Plain-language replies on request. No dependencies; makes no model or network calls. |  | no always-on text found in its hooks |
| `big-read-guard` | Refuses whole-file Reads of text files over 50 KB. Needs awk. | awk | no always-on text found in its hooks |
| `superpowers` | Skills for test-driven development, debugging and planning work in steps. Needs nothing. |  | 14 skills, 287 words of descriptions; plus hook text not counted |
| `ponytail` | Pushes Claude toward the shortest solution that works, with review and audit commands. Needs nothing. |  | 7 skills, 406 words of descriptions; plus hook text not counted |
| `scope-guard` | Counts the files a turn edits and stops at a threshold so you restate the goal. Needs Claude Code 2.1.287 or newer. |  | hook text not counted |
| `smart-compact` | Compacts at a good moment: after a commit or green tests, or just before the prompt cache expires. Needs Claude Code 2.1.295 or newer. |  | hook text not counted |
| `micro-compaction` | Adds /compact micro, which drops old file reads and thinking from the transcript without a model summary. Needs Claude Code 2.1.287 or newer. |  | hook text not counted |
| `cache-tax` | Keeps the one-hour prompt cache warm during breaks and warns once before a cold send. Warming sends model requests that cost tokens. Needs Claude Code 2.1.287 or newer. |  | hook text not counted |
| `secret-box` | Lets Claude use a secret without seeing it: you paste the key in a masked box and Claude gets a placeholder. Needs Claude Code 2.1.287 or newer. | Nothing | hook text not counted |
| `modwall` | Shows what each mod can reach as it loads and holds or refuses it by your policy. Needs Claude Code 2.1.287 or newer. |  | hook text not counted |
| `claude-code-setup` | Reads a codebase and recommends hooks, skills, MCP servers and subagents for it. Needs nothing. | Nothing | 1 skill, 55 words of descriptions |
| `mod-scout` | Ranks the mods you would use most from your recent sessions, with a skill that designs them. Needs Claude Code 2.1.287 or newer and Node 18 or newer. |  | 1 skill, 53 words of descriptions; plus hook text not counted |
| `clawd-spinner` | Animated spinner for the Claude Code terminal. Needs nothing extra. |  | hook text not counted |
| `unlazy` | Completion discipline for long tasks: write the checks first, then verify before reporting. |  | 1 skill, 69 words of descriptions |
| `pocock-skills` | Matt Pocock's engineering skills: grilling, domain modelling, bug diagnosis, writing for agents. The plugin loads the author's whole set. |  | about 27 skills (the repo notes); descriptions not counted |
| `debug-agent` | Debugging from runtime evidence: adds logging, guides reproduction and cites log lines to prove the root cause. |  | 1 skill, 45 words of descriptions |
| `health` | Audits a Claude Code setup: instruction drift, hooks, MCP servers and config layers. |  | 1 skill, 32 words of descriptions |
| `tare` | Finds where Claude Code usage went, from the session logs already on disk. |  | 1 skill, 214 words of descriptions |

## Rough context cost

Counted words added to every session by the members above: about 2,826. This is the sum of skill description words and the session-start text that could be counted. It is a rough guide in words, not a measurement of tokens; tokens run somewhat higher than words.
11 members in this group have text that was not counted: hooks that add session text, or skills whose descriptions were not read. Own mods add text for the model only where a figure appears above, plus short instructions some add when you trigger them.
Skill descriptions are what load at every session start. The body of a skill loads only when it is used. Third-party description counts come from the SKILL.md at the pinned commit.
