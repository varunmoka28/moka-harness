# Third-party plugins: pins and notes

Entries live in `marketplace.d/third-party-plugins.json`. Each points at the author's repo
with a full commit `sha`. Nothing from these repos is copied here. Facts below were read
with `gh api` (GET only) at the pinned commit. "Runs code" means the plugin ships a hook
file (or hooks in its manifest), or scripts a hook or command runs; "text only" means skills
and documents with no hook, MCP server or script.

`tests/third-party/test_plugins_install.sh` installs every entry in a sandbox and checks the
recorded commit equals the pin.

| entry | repo | pin | licence | where it sits | runs code? | change from manifest |
|---|---|---|---|---|---|---|
| superpowers | obra/superpowers | f2cbfbefebbf | MIT | repo root | yes: SessionStart hook and its script | none; the repo itself is the plugin |
| ponytail | DietrichGebert/ponytail | 356918eba965 | MIT | repo root | yes: hooks declared in the manifest, plus scripts | none |
| scope-guard | yash-gadodia/claude-mods | f4c1c751f679 | MIT | `scope-guard/` | yes: hooks | none |
| smart-compact | hellosverre/smart-compact | 5808714645da | MIT | repo root | yes: hooks, scripts | none |
| micro-compaction | ruihe774/cc-micro-compaction | 7409c6265aa9 | Unlicense | repo root | yes: hooks, scripts | repo found: the manifest said "resolve". The commit is the one the maintainer runs, and the author's plugin.json names this repo |
| cache-tax | karanb192/cache-tax | 06cac47ec125 | MIT | repo root | yes: hooks; keeping the cache warm sends model requests that cost tokens | none |
| secret-box | ray-amjad/claude-code-mods | 812a5e91bf14 | MIT | `plugins/secret-box` | yes: hooks, scripts | none; the commit is in public history |
| modwall | RadTech-Solutions/modwall | 959879ec08e5 | MIT | repo root | yes: hooks | none |
| claude-code-setup | anthropics/claude-plugins-official | fbe07fb6ce7d | Apache-2.0 | `plugins/claude-code-setup` | text only: one skill and references | none; the validator flags the name as reserved, which is expected |
| mod-scout | LeeHigma0201/claude-code-mods | 5e72188580da | MIT | `mods/mod-scout` | yes: hooks and a Node scanner script | none |
| codex | openai/codex-plugin-cc | 8e403f9d4b49 | Apache-2.0 | `plugins/codex` | yes: hooks, scripts that run the Codex CLI | none |
| session-board | danilpavlov/telescope-claude-code | 4a1c6ac36c7e | MIT | repo root | yes: hooks, scripts | none |
| diagram-design | cathrynlavery/diagram-design | f6db0decea96 | MIT | repo root | scripts, no hooks | none |
| diagram-pane | ray-amjad/claude-code-mods | 3af667dde3d4 | MIT | `plugins/diagram-pane` | yes: hooks | pin changed from dff4fde849be: that commit is not in the public repo. 3af667dde3d4 is the commit that added the plugin at version 0.1.0 (the version the maintainer runs) with the same file list as the installed copy. The later public commits are 0.2.x |
| impeccable | pbakaus/impeccable | 6af45ac9a5eb | Apache-2.0 | `plugin/` | yes: hooks, scripts | uses the `plugin/` subfolder, as the author's own marketplace does. The repo root also has a plugin.json, but it only points at skills and has no hooks |
| modern-web-guidance | GoogleChrome/modern-web-guidance | 4dd968349e54 | Apache-2.0 | repo root | text only: two skills | none |
| watch | bradautomates/claude-video | c333c2289e57 | MIT | repo root | yes: hooks, scripts; installs and runs yt-dlp and ffmpeg | none |
| typesafe | typesafe-ai/skills | 65a39f393687 | MIT | repo root | text only: one skill | none |

Full pins are in the JSON file. Authors are as given in each repo's plugin.json.

## Left out

None. All 19 rows of the manifest resolved to a public repo, a public commit and a licence.
