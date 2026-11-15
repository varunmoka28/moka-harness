# Third-party skills: pins and changes

Written for `marketplace.d/third-party-skills.json`. Every entry points at the author's repo at a full commit; nothing is copied into this repo. Repos, commits, skill folders and licence files were read with `gh api` (GET) and local partial clones, and each entry is installed at its pin by `tests/third-party/test_skills_install.sh`.

"Matches installed copy" means the SKILL.md at that commit is byte-equal to the copy in `~/.claude/skills`. Where no commit matches, the entry uses the default-branch head and says so.

How an entry is written:

- The repo has its own `.claude-plugin/plugin.json` that covers the skills taken and adds no code: the entry points at the repo and loads what the author's plugin loads.
- The repo has none: the entry is the manifest (`strict: false`) and lists the skill folders.
- The author's plugin.json adds hooks or an MCP server beyond the skills taken (anti-slop, caveman): the entry points at the skill folder instead, so only text loads. aws-core, treg and make-ugc keep the author's plugin.json as the manifest names them; aws-core and treg run code (hooks, MCP servers).

| entry | repo | pin | licence | skills taken | how the pin was chosen | change from the manifest and why |
|---|---|---|---|---|---|---|
| humanizer | blader/humanizer | `b48c832f0f809c1b5658edbb838c2521b72f2413` | MIT | humanizer | manifest pin (is head); installed copy differs | Uses the author's plugin.json. |
| anti-slop | miqdadbadjuber/anti-slop | `568d2f3c9894ddb1b865baf900504ca3ca91ccae` | MIT | antislop, antislop-code, antislop-copywriting, antislop-human, antislop-layoutmobile, antislop-ui | matches installed copy, all six (older than head) | Points at the `skills` folder with the entry as manifest, not the author's plugin.json, which also starts a Node MCP server. |
| sepia | Nanako0129/sepia | `a8d562f7b7d1e5773001f65dfa19f755156162d0` | MIT | sepia, sepia-hemingway, sepia-recreate, sepia-refactor, sepia-review, sepia-write | matches installed copy, all six (older than head) | Uses the author's plugin.json (six skills, no code). |
| unslop | heydamir/unslop | `becf3ed1b3386b03a5545b29d06cecd2bc11542b` | CC-BY-4.0 (credit required) | unslop | matches installed copy (older than head) |  |
| no-ai-slop | petergyang/no-ai-slop | `000650b156983f5159695b441477f4e63b25dc85` | MIT | no-ai-slop | manifest pin (is head); matches installed copy |  |
| caveman | JuliusBrussee/caveman | `b4ee71d557d96e3cbc14f88fa6e953a1362865f5` | Apache-2.0 and MIT (two files) | caveman | head; installed copy is shorter and matches no commit | Points at the `skills/caveman` folder only. The author's plugin.json adds Node hooks and loads 21 more skills. |
| unlazy | Leonxlnx/unlazy | `16671491f6679ad9378f52604d3bc2415b4120c7` | MIT | unlazy | manifest pin (is head); matches installed copy |  |
| pocock-skills | mattpocock/skills | `5863806dd4e15c63174bee4e7515a4256792ecfa` | MIT | grilling, grill-with-docs, diagnosing-bugs, domain-modeling, writing-for-agents | manifest pin (is head); matches installed copy for 2 of 5 | Uses the author's plugin.json, so it loads 27 skills, not 5. |
| debug-agent | millionco/debug-agent | `295af90bcfc16ba3578e6be91ed1c552261bb257` | MIT | debug-agent | manifest pin (is head); installed copy differs |  |
| health | tw93/claude-health | `163af0e2a9ce5170bd78840ebaf1ad989a767cff` | MIT (README only at the pin) | health | matches installed copy (older than head) | No LICENSE file at the pin; the README states MIT. `claude plugin validate` rejects the entry name (starts with `claude-`); installs still work. |
| tare | kelviq/tare | `03159f2c354e52e5309b0e0d7582b32a5c0d00d0` | MIT | tare | head; installed copy is trimmed and matches no commit | Uses the author's plugin.json (one skill and one command). |
| gstack | garrytan/gstack | `db35b8e5bffb596144c4c7f4a3b7eb5c078edaaf` | MIT | 16 skills: gstack, benchmark, browse, ... | manifest pin; matches installed copy, all 16 | The `gstack` skill is the repo root, listed as `./`. |
| diagram-skills | markdown-viewer/skills | `11bb2e80ee1f95f3d6afd4755e1a8c2b0b7340eb` | MIT (README only at the pin) | 14 skills: archimate, architecture, bpmn, ... | matches installed copy, all 14 (repo has since dropped them) | No LICENSE file at the pin; the README states MIT. `claude plugin validate` rejects the entry name (starts with `claude-`); installs still work. The repo now carries one skill and a different licence. |
| fireworks-tech-graph | yizhiyanhua-ai/fireworks-tech-graph | `ec98579d6c234fdd8b133db53fd4839a7f6520fe` | MIT | fireworks-tech-graph | matches installed copy (older than head) |  |
| anatomy | wheresryan22/anatomy | `1482e8469b0a9e0d8cc18ea2740a01423d29ae80` | MIT | anatomy | manifest pin (is head); installed copy differs |  |
| awwwards | juliobsz/skills | `add880bd6ec9f5592a1482846fc0dd282c9161bc` | MIT | awwwards | manifest pin (is head); installed copy differs |  |
| frontend-design | anthropics/skills | `00756142ab04c82a447693cf373c4e0c554d1005` | Apache-2.0 | frontend-design | manifest pin; matches installed copy (head differs) |  |
| accessibility | addyosmani/web-quality-skills | `afa8da942115f2961fdbfa80807ea0b232ff6c00` | MIT | accessibility | manifest pin (is head); installed copy differs | Uses the author's plugin.json, so it loads 6 skills, not 1. |
| reanimate | NiazMorshed2007/reanimate | `3f7a55a2986a84ca2173e86ee9127eefe31d046d` | MIT | reanimate | head; matches installed copy |  |
| blank-page | StewdioAI/blank-page | `cd42b37fa7cd0a5550e51f45cc8f82f63377b98c` | MIT | blank-page | matches installed copy (older than head) |  |
| infographics | K-Dense-AI/claude-scientific-writer | `9d12788db0b2bb7f18a12fc882e2009beae077b6` | MIT | infographics | manifest pin; installed copy differs from it |  |
| hyperframes | heygen-com/hyperframes | `87baff884253b0cfd8bb6efb299afb1d04525c11` | Apache-2.0 | hyperframes, hyperframes-cli, hyperframes-registry, media-use, slideshow | matches installed copy for the five kept skills (older than head) | Uses the author's plugin.json, so it loads 7 skills. Five skills dropped (below). |
| gpt-image-2 | ConardLi/garden-skills | `9578a34edf3c359da23d8a632b72790834961d11` | MIT | gpt-image-2 | head; matches installed copy |  |
| make-ugc | superdesigndev/treg | `6ffe8df7126479631a4c649467aa307505e28a1b` | Apache-2.0 plus the author's additional terms | make-ugc | manifest pin (is head); installed copy differs | Subfolder `plugins/workflows/make-ugc`, which has its own plugin.json. |
| k-dense-science | K-Dense-AI/claude-scientific-skills | `04a7be2319492a1b084cfd36ee1f82219d743b90` | MIT | 21 skills: datacommons-client, edgartools, fred-economic-data, ... | matches installed copy, all 21 (older than head) | Layout at this pin is `scientific-skills/`; the author later moved it to `skills/` and removed six of the names. |
| orchestra-research | Orchestra-Research/AI-research-SKILLs | `773a52944ba4747a18bd4ae9ade53fff041adcbc` | MIT | 0-autoresearch-skill | manifest pin (is head); matches installed copy | `arxiv-database` dropped (below). |
| book-to-skill | virgiliojr94/book-to-skill | `e7bb659d3261491c8b28793dcb9102fa64a46c22` | MIT | book-to-skill | manifest pin (is head); installed copy differs |  |
| anysearch | anysearch-ai/anysearch-skill | `e70355ba9957cf69923f49ae8ffb224ccc3ae7f0` | Apache-2.0 | anysearch | manifest pin (is head); installed copy differs |  |
| agent-reach | Panniantong/Agent-Reach | `c70ae6da5d39bc90e09ad2ae0575ccc89f31e284` | MIT | agent-reach | head; installed copy matches no commit | The skill now sits at `agent_reach/skill`, so the entry lists that folder. |
| graphify | Graphify-Labs/graphify | `7ff7bd2e8f555405bb73081b3698cbf22e8b9aa0` | MIT at the pin (head: Apache-2.0 and MIT) | graphify | manifest pin; installed copy differs | The author's file is lower-case `skill.md` (their installer renames it). The test finds it on macOS; Claude Code looks for `SKILL.md`, so on a case-sensitive disk the skill may not load. |
| big-arrow | franzenzenhofer/big-arrow-on-the-screen | `64ed5397e45c44164629e0aef6c3622fe233b881` | MIT | big-arrow | manifest pin; installed copy differs |  |
| supabase-skills | supabase/agent-skills | `c9be0e931b7930f7d02126d04774d904c381e7d7` | MIT | supabase, supabase-postgres-best-practices | head; matches installed copy for both |  |
| treg | superdesigndev/treg | `6ffe8df7126479631a4c649467aa307505e28a1b` | Apache-2.0 plus the author's additional terms | treg | manifest pin (is head); installed copy differs | Subfolder `plugins/treg`: plugin.json declares an MCP server. |
| aws-core | aws/agent-toolkit-for-aws | `f18bffee72a2b35cb979a015926208fdab8b6548` | Apache-2.0 | 25 skills: aws-ai-ml, aws-auth, aws-billing-and-cost-management, ... | head; installed copies match no commit | Subfolder `plugins/aws-core`: plugin.json declares hooks, and the folder has an MCP config. Loads 27 skills; two of them (`aws-emulator`, `aws-secrets-manager`) are not among the 25. |

## Left out

- `llm-council`: the only public copy of the skill is `aiwithremy/claude-skills-llm-council`, which has no licence file. The installed text cites `karpathy/llm-council`, a different project.
- `bgpt-paper-search`: the repo named in the skill's own header, `connerlambden/bgpt-mcp`, returns 404. K-Dense's repo carries a copy under `skills/bgpt-paper-search`; add it to `k-dense-science` if you want it.

## Dropped from an entry

- `hyperframes`: `hyperframes-animation`, `-audio`, `-core`, `-creative` and `-keyframes` were retired by the author on 2026-10-21 and are absent at head. No commit holds all ten installed skills, so the entry carries the five that still exist.
- `orchestra-research`: `arxiv-database` is not in the Orchestra repo. An older layout of K-Dense's `claude-scientific-skills` held a skill of that name, but the installed copy matches no commit in either repo.

## Licence notes

- `treg`, `make-ugc`: the licence is Apache-2.0 with additional terms that bar offering the software to third parties as a hosted or embedded service. Linking is fine; copying or forking needs a read of those terms.
- `unslop`: CC-BY-4.0 requires credit to the author. The entry links to the author's repo, which keeps it.
- `caveman`, `graphify`: two licence files; the entry text above names both.
