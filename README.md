# moka-harness

This is my Claude Code setup, packaged as one plugin marketplace so you can add all of it, or any part of it, to your own install.

Some of it I built: small mods, guard hooks, and a short working-style file. Some I adapted from other people's work, and their names are on the plugins. Most of it I did not write. Those entries are other authors' plugins and skills, each pointing at the author's own repo and frozen to one commit. Nothing from those repos is copied here.

It has been checked on macOS only. A few parts are macOS only and say so. Nothing here has been tried on Windows.

Read [how far to trust this](#how-far-to-trust-this) and [docs/known-risks.md](docs/known-risks.md) before you install anything.

## Install

Run these in a shell. Inside a Claude Code session, `/plugin` only opens a panel; it does not install.

```
claude plugin marketplace add varunmoka28/moka-harness
claude plugin install core@moka-harness
```

`core` is the working-style file, three guard hooks, and a `doctor` skill. It needs only Claude Code, plus `python3`, `git` and `jq` for the hooks and `doctor`.

For the whole everyday set, install a bundle instead:

```
claude plugin install core-bundle@moka-harness
```

Each group has its own bundle, named after the group:

```
claude plugin install design@moka-harness
```

To install less, install single plugins by name, for example `claude plugin install collision-guard@moka-harness`. The [trust table](docs/trust-table.md) lists every name.

After installing, run `/core:doctor` in a session. It reports which outside tools and keys the groups you installed still need. It only reads; it installs nothing.

## Groups

| Group | Install | What it needs |
|---|---|---|
| core | `core-bundle` | Nothing beyond Claude Code, `python3`, `git` and `jq`. A few mods are macOS only. |
| writing | `writing` | Nothing. |
| design | `design` | Nothing. `design-direction` is macOS only. |
| media | `media` | Some skills need a paid image or video key. |
| research | `research` | A free alphaXiv account for the paper search server. `ffmpeg` and `yt-dlp` for `watch`. |
| memory | `memory` | Nothing extra. It holds the `homunculus` plugin. Claude Code's own memory needs no install. |
| multi-agent | `multi-agent` | `herdr` and `tuios` installed. Codex and agy are optional. `dispatch-router` needs a TypeSafe key. |
| jev | `jev` | A TypeSafe (Jev) API key, paid per call. |
| cloud | `cloud` | An AWS account and credentials. |

Each group has a page with its members, what each one needs, and a rough count of how much text it adds to every session: [core](docs/groups/core.md), [writing](docs/groups/writing.md), [design](docs/groups/design.md), [media](docs/groups/media.md), [research](docs/groups/research.md), [memory](docs/groups/memory.md), [multi-agent](docs/groups/multi-agent.md), [jev](docs/groups/jev.md), [cloud](docs/groups/cloud.md).

Three entries belong to no group and are installed on their own: `fork-cleanup`, `gstack` and `treg`. See [add-ons](docs/groups/add-ons.md).

## Three overlapping pairs

Both plugins of each pair are here. They do similar jobs, so you may want only one.

| Pair | Which I prefer |
|---|---|
| `cache-clock` and `cache-tax` | |
| `agent-board` and `session-board` | |
| `input-router` and `big-read-guard` | |

## Remove it

```
claude plugin marketplace remove moka-harness
```

This removes the marketplace and uninstalls its plugins. It leaves some files behind, and that is Claude Code's behaviour. Relative to your Claude config folder:

- `plugins/cache/moka-harness/<plugin>/<version>/` for every plugin you installed, each holding an `.orphaned_at` marker.
- `plugins/.last_inuse_sweep`.
- Files Claude Code writes by itself: `.claude.json`, `settings.json`, `backups/.claude.json.backup.<timestamp>`, `plugins/installed_plugins.json` and `plugins/known_marketplaces.json`.

Claude Code marks those cache folders as orphaned itself. I have not tested what happens to a plugin's own data folder (logs, saved state) on removal.

## How far to trust this

A pin freezes an item. It does not make the item safe.

Every third-party entry carries a full commit hash, so the author's later changes cannot reach you. If the author published something bad before that commit, the pin does not help. Plugins can run hooks and MCP servers on your machine with your permissions, and mods are not sandboxed. Nobody has read every line of every repo listed here, me included.

What I can offer is a record. The [trust table](docs/trust-table.md) lists every entry with its author, licence, pinned commit, whether it runs code, and whether it sends text off your machine. It has two columns, "code read" and "why I use this", that I fill in as I go. A blank means I have not done it yet.

I move a pin forward only after trying the new version, and each move gets a line in [CHANGELOG.md](CHANGELOG.md). If an author deletes a repo, its entry stops installing until I replace it.

The plugins I wrote that delete or stop something start in dry-run and do nothing until you give them a scope. [docs/known-risks.md](docs/known-risks.md) names each one.

## More detail

- [docs/trust-table.md](docs/trust-table.md): every entry, one row each.
- [docs/WIRING.md](docs/WIRING.md): the hook events, commands, tools and settings each of my own plugins adds to a session.
- [docs/known-risks.md](docs/known-risks.md): what to know before installing.
- [docs/groups/](docs/groups/core.md): one page per group.

## Credits

[CREDITS.md](CREDITS.md) lists every third-party entry with its author, repo, licence and pinned commit. It is generated from the marketplace file.

Six of my own plugins are adapted from other people's mods, and their copyright lines are kept in each plugin's `LICENSE`:

- `terminal-desk` and `assumption-log`: from Terminal Desk by ClariSortAi (MIT).
- `input-router`: connector trimming adapted from lean-connector-results by Creator Scripts (MIT).
- `next-steps-autopilot`: built on next-steps by Thariq Shihipar (MIT).
- `noticeboard`: based on decision-tree by Ray Amjad (MIT).
- `strict-guard`: adapted from Blast Radius in anthropics/claude-code-playground (Apache-2.0). See its `NOTICE`.

## Licence

The plugins in `plugins/` are MIT, except `strict-guard`, which is Apache-2.0. Third-party entries keep their own licences, listed in the trust table.
