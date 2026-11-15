# moka-harness

[![checks](https://github.com/varunmoka28/moka-harness/actions/workflows/checks.yml/badge.svg)](https://github.com/varunmoka28/moka-harness/actions/workflows/checks.yml)
[![pin-check](https://github.com/varunmoka28/moka-harness/actions/workflows/pin-check.yml/badge.svg)](https://github.com/varunmoka28/moka-harness/actions/workflows/pin-check.yml)
[![licence: MIT and Apache-2.0](https://img.shields.io/badge/licence-MIT%20and%20Apache--2.0-blue.svg)](#licence)
![checked on macOS](https://img.shields.io/badge/checked%20on-macOS-lightgrey.svg)

My daily Claude Code setup as one plugin marketplace, checked on macOS only: guard hooks, terminal mods, working-style rules, and third-party plugins and skills pinned to one commit each.

```
claude plugin marketplace add varunmoka28/moka-harness
claude plugin install core@moka-harness
```

Run these in a shell. Inside a Claude Code session, `/plugin` only opens a panel; it does not install. Then run `/core:doctor` in a session: it reports which outside tools and keys the groups you installed still need. It only reads; it installs nothing.

`core` is the working-style file, three guard hooks and a `doctor` skill. It needs Claude Code, bash, `python3`, `git` and `jq`, plus ps for one of the hooks.

[What it is](#what-it-is) · [How far to trust this](#how-far-to-trust-this) · [Own plugins](#own-plugins-a-sample) · [Groups](#groups) · [Remove it](#remove-it) · [Credits](#credits)

## What it is

I'm Varun Moka. I build with Claude Code by directing agents, and this is the setup I use every day. It has three parts:

- **My own plugins.** Small mods for the Claude Code terminal, guard hooks that stop a bad delete or a careless edit, and a short working-style file.
- **Adapted plugins.** Six plugins built on other people's mods. The original authors are named in [Credits](#credits) and in each plugin's `LICENSE`.
- **Other people's plugins and skills.** This is most of the list. Each entry points at its author's own repo and is frozen to one full commit hash. Nothing from those repos is copied here.

It has been checked on macOS only. A few parts are macOS only and say so. Nothing here has been tried on Windows.

Read [how far to trust this](#how-far-to-trust-this) and [docs/known-risks.md](docs/known-risks.md) before you install anything.

## How far to trust this

A pin freezes an item. It does not make the item safe.

Every third-party entry carries a full commit hash, so the author's later changes cannot reach you. If the author published something bad before that commit, the pin does not help. Plugins can run hooks and MCP servers on your machine with your permissions, and mods are not sandboxed. Nobody has read every line of every repo listed here, me included.

The [trust table](docs/trust-table.md) lists every entry with its author, licence, pinned commit, whether it runs code, and whether it sends text off your machine. It has two columns, "code read" and "why I use this", that I fill in as I go. A blank means I have not done it yet.

I move a pin forward only after trying the new version. If an author deletes a repo, its entry stops installing until I replace it.

The plugins I wrote that delete files, worktrees, forks or windows, or stop processes, start in dry-run or off and do nothing until you give them a scope. The guards that only refuse or ask are different: `strict-guard`, `big-read-guard`, `collision-guard` and `dispatch-router` are active as soon as they are installed. [docs/known-risks.md](docs/known-risks.md) names each one and its guard.

Two automated checks back this up. On every push, the marketplace file and every plugin folder are validated and the repo is scanned for leaked personal data. Once a week, a second job confirms each pinned commit still exists.

## Own plugins, a sample

A sample of my own plugins, by the job they do. Each one has a README with the same five headings: what it does, what it needs, the hook events it uses, what it deletes or stops, and what it sends off the machine.

| Job | Plugins |
|---|---|
| Stop a mistake before it happens | `collision-guard` asks before Claude edits a file something else just changed. `strict-guard` refuses destructive shell commands by fixed rules. `big-read-guard` refuses whole-file reads of large text files. |
| See what a session is doing | `terminal-desk` adds a stats bar and a side pane. `assumption-log` shows each guess Claude makes about what you want. `cache-clock` counts down the prompt cache. `clean-view` replaces tool output with a plain checklist. |
| Run several agents side by side | `agent-board` watches your other agent tabs. `park` saves a session and writes a note for the next one. `unattended` stops a session from asking questions when nobody is at the keyboard. |
| Keep the context small | `context-guard` warns when the conversation gets large. `image-shrinker` shrinks big images before Claude reads them. `input-router` hands large reads to a small model first. |

The full list, with the third-party entries, is in the [trust table](docs/trust-table.md). [docs/WIRING.md](docs/WIRING.md) shows the hook events, commands, tools and settings each of my own plugins adds to a session.

## Groups

| Group | Install | What it needs |
|---|---|---|
| core | `core-bundle` | Claude Code 2.1.295 or newer for every mod, `python3`, `git`, `jq`, awk, and Node 18 or newer (one mod, and npx for the context7 server). A few mods are macOS only. |
| writing | `writing` | Nothing. |
| design | `design` | Claude Code 2.1.287 or newer for `diagram-pane`. `infographics` needs its author's API keys. `design-direction` is macOS only. |
| media | `media` | Some skills need a paid image or video key. |
| research | `research` | A free alphaXiv account for the paper search server. `ffmpeg` and `yt-dlp` for `watch`. |
| multi-agent | `multi-agent` | `herdr` and `tuios` installed. bun and kanzo for the two MCP servers, tmux for `session-board`. Codex (Node 18.18 or newer) and agy are optional. `dispatch-router` needs a TypeSafe key. |
| jev | `jev` | A TypeSafe (Jev) API key, paid per call. |
| cloud | `cloud` | An AWS account and credentials. |

Each group has a page with its members, what each one needs, and a rough count of how much text it adds to every session: [core](docs/groups/core.md), [writing](docs/groups/writing.md), [design](docs/groups/design.md), [media](docs/groups/media.md), [research](docs/groups/research.md), [multi-agent](docs/groups/multi-agent.md), [jev](docs/groups/jev.md), [cloud](docs/groups/cloud.md).

Three entries belong to no group and are installed on their own: `fork-cleanup`, `gstack` and `treg`. See [add-ons](docs/groups/add-ons.md).

### Install more

For the whole everyday set, install a bundle:

```
claude plugin install core-bundle@moka-harness
```

Each group has its own bundle, named after the group:

```
claude plugin install design@moka-harness
```

To install less, install single plugins by name, for example `claude plugin install collision-guard@moka-harness`. The [trust table](docs/trust-table.md) lists every name.

### Update

```
claude plugin marketplace update moka-harness
claude plugin update core@moka-harness
```

Third-party entries only change when I move a pin, and each move gets a line in [CHANGELOG.md](CHANGELOG.md).

### Three overlapping pairs

Both plugins of each pair are here. They do similar jobs, so you may want only one.

| Pair | Which I prefer |
|---|---|
| `cache-clock` and `cache-tax` | `cache-clock` |
| `agent-board` and `session-board` | `agent-board` |
| `input-router` and `big-read-guard` | `input-router` |

## Remove it

```
claude plugin marketplace remove moka-harness
```

This removes the marketplace and uninstalls its plugins. It leaves some files behind, and that is Claude Code's behaviour. Relative to your Claude config folder:

- `plugins/cache/moka-harness/<plugin>/<version>/` for every plugin you installed, each holding an `.orphaned_at` marker.
- `plugins/.last_inuse_sweep`.
- Files Claude Code writes by itself: `.claude.json`, `settings.json`, `backups/.claude.json.backup.<timestamp>`, `plugins/installed_plugins.json` and `plugins/known_marketplaces.json`.

Claude Code marks those cache folders as orphaned itself. I have not tested what happens to a plugin's own data folder (logs, saved state) on removal.

## Documentation

- [docs/trust-table.md](docs/trust-table.md): every entry, one row each.
- [docs/WIRING.md](docs/WIRING.md): the hook events, commands, tools and settings each of my own plugins adds to a session.
- [docs/known-risks.md](docs/known-risks.md): what to know before installing.
- [Group pages](docs/groups/core.md): one page per group, starting with core.
- [CHANGELOG.md](CHANGELOG.md): every pin move and every entry added or removed.

## Issues

If something breaks on your machine, open an [issue](https://github.com/varunmoka28/moka-harness/issues) with the plugin name, your Claude Code version (`claude --version`) and your operating system. For a problem inside a third-party entry, the author's own repo is the right place; [CREDITS.md](CREDITS.md) links each one.

## Credits

[CREDITS.md](CREDITS.md) lists every third-party entry with its repo and pinned commit. It is generated from the marketplace file, and where that file names no author or licence the row says unknown; the [trust table](docs/trust-table.md) has the author and licence for every entry.

Six of my own plugins are adapted from other people's mods, and their copyright lines are kept in each plugin's `LICENSE`:

- `terminal-desk` and `assumption-log`: from Terminal Desk by ClariSortAi (MIT).
- `input-router`: connector trimming adapted from lean-connector-results by Creator Scripts (MIT).
- `next-steps-autopilot`: built on next-steps by Thariq Shihipar (MIT).
- `noticeboard`: based on decision-tree by Ray Amjad (MIT).
- `strict-guard`: adapted from Blast Radius in anthropics/claude-code-playground (Apache-2.0). See its `NOTICE`.

## Licence

The plugins in `plugins/` are MIT, except `strict-guard`, which is Apache-2.0. Third-party entries keep their own licences, listed in the trust table.
