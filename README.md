<p align="center"><img src="docs/readme/icon.svg" alt="moka-harness icon" width="112"></p>

<h1 align="center"><img src="docs/readme/wordmark.svg" alt="moka-harness" width="100%"></h1>

<div align="center">

[![checks](https://github.com/varunmoka28/moka-harness/actions/workflows/checks.yml/badge.svg)](https://github.com/varunmoka28/moka-harness/actions/workflows/checks.yml)
[![pin-check](https://github.com/varunmoka28/moka-harness/actions/workflows/pin-check.yml/badge.svg)](https://github.com/varunmoka28/moka-harness/actions/workflows/pin-check.yml)
[![licence: MIT and Apache-2.0](https://img.shields.io/badge/licence-MIT%20and%20Apache--2.0-blue.svg)](#licence)
![checked on macOS](https://img.shields.io/badge/checked%20on-macOS-lightgrey.svg)

</div>

A Claude Code harness as one plugin marketplace: guard hooks, terminal mods, working-style rules, and third-party plugins and skills pinned to one commit each.

The [catalogue](https://varunmoka28.github.io/moka-harness/) lists every entry with its source, what it needs and how it works, with screenshots.

## Install

Install [herdr](https://herdr.dev) first (`brew install herdr`) and run Claude Code inside it. `agent-board` and the `multi-agent` group need it, and `park`, `terminal-desk` and `noticeboard` use it when it is there.

Then run these in a shell. Inside a session, `/plugin` only opens a panel.

```
claude plugin marketplace add varunmoka28/moka-harness
claude plugin install core@moka-harness
```

`core` is the working-style file, three guard hooks and a `doctor` skill. Run `/core:doctor` in a session to see which tools and keys your installed plugins still need. It installs nothing.

For more, install a group bundle (for example `claude plugin install core-bundle@moka-harness`) or single plugins by name. To update:

```
claude plugin marketplace update moka-harness
claude plugin update core@moka-harness
```

## What it is

- **Harness plugins**, in `plugins/`: terminal mods, guard hooks and the working-style file. Most of them started from mods other people published and were changed for this harness. The originals known by name are listed under [Credits](#credits).
- **Third-party plugins and skills**, which are most of the list. Each one points at its author's repo, pinned to a full commit hash. None of their code is copied here.

An install adds hooks, terminal mods, skills and slash commands, and for some bundles MCP servers. No plugin edits your `settings.json` or `CLAUDE.md`. [docs/WIRING.md](docs/WIRING.md) lists what each harness plugin hooks into.

Everything has been checked on macOS only.

## Prerequisites

The `core` plugin needs `python3`, `git`, `jq`, bash, awk and ps. The rest depends on the group:

| Group | Needs |
|---|---|
| core-bundle | Claude Code 2.1.295 or newer. Node 18 or newer (`mod-scout`, and npx for the context7 server). sips for `image-shrinker`, macOS only. |
| multi-agent | `herdr` and `tuios`. bun and a claude-peers folder, kanzo, tmux for `session-board`, a TypeSafe key for `dispatch-router`. Codex CLI and agy are optional. |
| research | A free alphaXiv account. `ffmpeg` and `yt-dlp` for `watch`. |
| jev | A TypeSafe API key, paid per call. |
| cloud | AWS credentials, and uv. |
| design, media | Some entries need their author's API keys. |
| writing | Nothing. |

Most single mods work from Claude Code 2.1.287. The [group pages](docs/groups/core.md) list each member's needs.

## Groups

| Group | What it is for |
|---|---|
| [core](docs/groups/core.md) | Working-style rules, guard hooks, session mods and general skills. The everyday set. |
| [writing](docs/groups/writing.md) | Editing prose and keeping generated text from sounding generated. |
| [design](docs/groups/design.md) | Diagram, UI and design skills, and a mod that opens HTML previews in a browser. |
| [media](docs/groups/media.md) | Making images, video and short clips. |
| [research](docs/groups/research.md) | Paper search, and reading web pages and videos. |
| [multi-agent](docs/groups/multi-agent.md) | Running several agents side by side. |
| [jev](docs/groups/jev.md) | Mods and a skill that call the TypeSafe (Jev) service. |
| [cloud](docs/groups/cloud.md) | AWS skills and the AWS MCP server. |

Three entries belong to no group: `fork-cleanup`, `gstack` and `treg` ([add-ons](docs/groups/add-ons.md)). Three pairs overlap, so pick one of each: `cache-clock` or `cache-tax`, `agent-board` or `session-board`, `input-router` or `big-read-guard`.

## How far to trust this

A pin stops an author's later changes from reaching you, but it does not make the pinned code safe. Plugins run hooks and MCP servers with your permissions, and mods are not sandboxed. Nobody has read every line of every third-party repo here.

The [trust table](docs/trust-table.md) shows, for every entry, the author, licence, pinned commit, whether it runs code and whether it sends text off your machine. [docs/known-risks.md](docs/known-risks.md) covers the plugins that can delete or stop things. Those start in dry-run or off and act only inside a scope you set. Four guards are active as soon as they are installed, because they only refuse or ask: `strict-guard`, `big-read-guard`, `collision-guard` and `dispatch-router`.

On every push, CI validates the marketplace and scans for leaked personal data. A weekly job checks that every pinned commit still exists. A pin moves only after the new version has been tried, and each move gets a line in [CHANGELOG.md](CHANGELOG.md).

There is no support or response-time promise, and nothing has been tried on Windows or Linux.

## When something goes wrong

1. Run `/core:doctor` to see missing tools and keys.
2. A guard that refuses says why in its message.
3. Turn one plugin off with `claude plugin disable <name>@moka-harness`, and back on with `claude plugin enable`.
4. Open an [issue](https://github.com/varunmoka28/moka-harness/issues) with the plugin name, `claude --version` and your OS. A bug inside a third-party entry belongs in its author's repo ([CREDITS.md](CREDITS.md) links each one). Security reports go through [.github/SECURITY.md](.github/SECURITY.md).

## Remove it

```
claude plugin marketplace remove moka-harness
```

This uninstalls the plugins. Claude Code leaves their cache folders under `plugins/cache/moka-harness/` in your config folder, each marked with an `.orphaned_at` file. What happens to a plugin's data folder on removal has not been tested.

## Contributing

Pull requests are welcome. Open an issue first for anything beyond a typo. A harness plugin keeps the five-heading README (what it does, what it needs, hook events, what it deletes or stops, what it sends off the machine). A pin move needs a CHANGELOG line. Run `bash tests/scripts/run_all.sh` before a PR; it needs no network.

## Credits

[CREDITS.md](CREDITS.md) lists every third-party entry with its repo and pinned commit, and the [trust table](docs/trust-table.md) has each author and licence. These harness plugins are built on named originals, whose copyright lines are kept in each plugin's LICENSE:

- `terminal-desk` and `assumption-log`: from Terminal Desk by ClariSortAi (MIT).
- `input-router`: connector trimming adapted from lean-connector-results by Creator Scripts (MIT).
- `next-steps-autopilot`: built on next-steps by Thariq Shihipar (MIT).
- `noticeboard`: based on decision-tree by Ray Amjad (MIT).
- `strict-guard`: adapted from Blast Radius in anthropics/claude-code-playground (Apache-2.0). See its `NOTICE`.

## Licence

The plugins in `plugins/` are MIT, except `strict-guard`, which is Apache-2.0. Third-party entries keep their own licences, listed in the trust table.
