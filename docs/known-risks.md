# Known risks

Read this before installing. It covers what can go wrong, where each risky piece is, and how it is guarded. The [trust table](trust-table.md) has the per-entry facts.

## Hooks that delete or stop something

Each of these is a harness plugin. The first six rows follow one rule: it starts in dry-run or off, it acts only inside a scope you set (a folder list, a tuios session, a match text or a GitHub account; it never guesses one), and it logs its actions in the plugin's data folder. They have tests under `tests/` or in the plugin folder. The rows after those are guards of a different kind, and each says how it is limited.

| Plugin | What it can do | Guard |
|---|---|---|
| `core`: `delete_guard` | Blocks `rm`, `find -delete`, `git clean`, `rmtree` and similar when they touch a protected path. It only blocks. | `protected_paths` is empty by default, so it does nothing. `delete_guard_dry_run` is on: it logs and allows. |
| `core`: `worktree_sweep` | After `gh pr merge`, removes git worktrees and their local branches that are merged, clean and fully pushed. | Only under `worktree_sweep_roots`, which is empty. Dry-run on. |
| `core`: `stale_agent_reaper` | At session start, stops processes whose command line contains a text you set and that are older than a set age. | Does nothing while `reaper_match` is empty. Dry-run on. Never stops the session's own process or its parents. |
| `disk-sweep` | After you tick rows and press twice, removes old plugin versions, `file-history`, `debug` files and conversation transcripts with `rm -rf`. Removed transcripts cannot be resumed. | `dryRun` is on and `deleteRoots` is empty, so nothing is deleted until you set both. macOS only. |
| `multi-agent-kit`: window reaper | Closes tuios windows that are finished, empty or idle. | Only inside the session named by `tuios_session`, empty by default. `reaper_dry_run` is on. |
| `fork-cleanup` | Deletes stale forks from your GitHub account. A deleted repository cannot be undone. | Off by default (`defaultEnabled: false`), and `delete_forks` is also off. It touches only the account you name, only forks, only forks with no unique commits, and never anything on your keep list. |
| `park` | `/park close`, inside herdr only, closes the agent tabs of other terminal sessions that saved successfully. | Runs only when you type it. It refuses if any tab did not save, and never closes your own tab. |
| `strict-guard` | Refuses `rm`, `git reset --hard`, `git clean`, force pushes and migrations that look harmful, without asking you. | It only refuses; it never runs or deletes anything. It is a text check on the command line, not a sandbox, so a command it cannot read can get past it. |
| `unattended` | While on, refuses Claude's question prompts and plan mode, so a session carries on without you. | Off until you type `/unattended`. Claude then picks an option itself, so it may do something you would have chosen differently. |
| `dispatch-router` | Refuses an agent launch that was not routed first. | Part of what it is for. Remove the plugin to stop it. |
| `collision-guard` | Can cancel one edit when another session changed the same file in the last 30 minutes. | Asks you first. With `unattended` on, the edit goes ahead and a note is added. |
| `read-fence` | Refuses reads of the fenced skill folders. | Off by default. |
| `big-read-guard` | Refuses a whole-file read of a text file over 50 KB. | Claude is told how to read a range, and a read with `offset` and `limit` always goes through. |

Smaller ones, all limited to the plugin's own files: `design-direction` deletes its own HTML files in `/tmp/design-direction` once a day old. `image-shrinker` deletes its own temporary copies as soon as Claude has read them. `session-peers` deletes its own session records. `idea-shelf` deletes an idea only when you remove it.

Three more can compact or send something when you ask or opt in: `context-guard` (auto-compact is off unless `CONTEXT_GUARD_AUTO_COMPACT=1`), `cache-clock` (a button you press) and `agent-board` (sends `/compact` to an idle Codex tab only with `AGENT_BOARD_COMPACT=1`).

Third-party hooks are not covered by these rules. `scope-guard`, `modwall`, `micro-compaction`, `smart-compact`, `cache-tax`, `secret-box`, `mod-scout`, `session-board`, `impeccable`, `codex`, `watch` and others ship hooks that run on your machine. The trust table lists which ones run code. Not all of that code has been read.

## Plugins that send text to a model or an outside service

Any plugin that makes a model call does so through Claude Code, on your own account, and your conversation goes to the model as usual. These add calls of their own, or talk to other hosts:

- `input-router`: the text of large files and connector results goes to a small Claude model. Off by default.
- `clean-view`, `tab-namer`, `side-chat`, `reddit-watch`, `next-steps-autopilot`: short extra model calls, as each README describes. `terminal-desk` makes one only if you run `/desk check on`.
- `dispatch-router`, `prompt-enhancer`, `run-ledger`: send text to `api.typesafe.ai` with your key. The last one only when its `mode` is not `off`.
- `reddit-watch`: fetches public RSS feeds from `www.reddit.com`. Off until you type `/reddit on`.
- `fork-cleanup`: talks to GitHub through `gh`.
- MCP servers in bundles: `context7` (core-bundle) sends library lookups to the Context7 service. `alphaxiv` (research) sends paper searches to alphaxiv.org. `aws-mcp` (cloud) talks to AWS. `claude-peers` and `kanzo` (multi-agent) run on your machine.
- Third-party: `treg` sends tool calls to the treg service. `codex` runs the Codex CLI, which sends text to OpenAI. `cache-tax` sends model requests to keep your prompt cache warm, which cost tokens.

Each plugin's README, under "What it sends off the machine", has the detail.

## Paid keys

- `jev` group (`prompt-enhancer`, `run-ledger`, the `typesafe` skill) and `dispatch-router`: a TypeSafe API key, paid per call. Without a key they do nothing and say so.
- `treg`: a treg account, paid.
- `media` group: some skills need a paid image or video key.
- `cloud` group: an AWS account. AWS bills what you use through it.
- `research` group: the alphaXiv server needs a free account.

Keys that a plugin asks for are stored through Claude Code's plugin settings as sensitive values. They are not written to `settings.json` or the chat.

## macOS only, or mostly

- `image-shrinker`, `disk-sweep`, `design-direction`, `side-chat` (the copy action): macOS.
- The `multi-agent-kit` reaper uses macOS `md5` and `stat -f`.
- `park` and `read-fence` work on macOS and Linux. Windows paths are not handled.
- The whole repo has been checked on macOS only.

## The reserved-name finding

`claude plugin validate` rejects one entry name here: `claude-code-setup`. Claude Code reserves names that start with `claude-`, to stop outside plugins passing as Anthropic's own. This entry is Anthropic's own plugin from its public repo, listed under the author's name. A step 0 test showed that Claude Code still installs and lists a plugin under such a name, and only the validator objects. The automated validate check here allows that one error and no other. If a later Claude Code release starts refusing the install itself, this entry will fail to install.

## Orphaned cache folders after removal

`claude plugin marketplace remove moka-harness` removes the plugin and marketplace records but leaves `plugins/cache/moka-harness/<plugin>/<version>/` folders, each with an `.orphaned_at` marker, plus `plugins/.last_inuse_sweep`.

## Licence cautions

- `treg` and `make-ugc`: Apache-2.0 with additional terms that bar offering the software to third parties as a hosted or embedded service. Using it is fine. Copying or forking needs a read of those terms.
- `unslop` is CC-BY-4.0 and needs credit to its author. [CREDITS.md](../CREDITS.md) gives it.
- `health` and `diagram-skills` have no LICENSE file at the pinned commit either. The READMEs state MIT.

More detail is in [docs/third-party-skills-notes.md](third-party-skills-notes.md) and [docs/third-party-plugins-notes.md](third-party-plugins-notes.md).

## Other things that can trip you

- `graphify`'s skill file is lower-case `skill.md` at the pinned commit. Claude Code looks for `SKILL.md`, so on a case-sensitive disk the skill may not load.
- `diagram-skills` is pinned to a commit that the author's repo has since moved past. The pin keeps working while the commit exists. If the author removes it, the entry stops installing.
- `hyperframes` is pinned to a commit that holds five of the author's ten skills. The other five were retired by the author and are not in this entry.
- Some entries load the author's whole plugin, not only the skills named in the description. `pocock-skills` loads 27 skills, `accessibility` loads 6, `hyperframes` loads 7 and `aws-core` loads 27.
