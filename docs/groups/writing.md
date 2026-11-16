# Group: writing

Skills for editing prose and keeping generated text from sounding generated.

Install: `claude plugin install writing@moka-harness`

To install less, install single members by name, for example `claude plugin install humanizer@moka-harness`.

## Needs

Nothing.

## Members

| Member | What it is | Needs | Rough context cost |
|---|---|---|---|
| `humanizer` | Rewrites AI-sounding text so it reads like the writer without changing what it says. |  | 1 skill, 44 words of descriptions |
| `anti-slop` | Rules that keep generated UI, copy and code from looking like generic AI output. Six skills, text only. |  | 6 skills, 118 words of descriptions |
| `sepia` | Writing skills for removing AI tells: write, review, refactor, recreate and a Hemingway pass. |  | 6 skills, 178 words of descriptions |
| `unslop` | Turns an AI-looking interface into a designed one: spacing, colour, icons, copy and type. |  | 1 skill, 110 words of descriptions |
| `no-ai-slop` | Edits drafts into sharper, more human writing in the writer's own voice, or flags AI-writing patterns without rewriting. |  | 1 skill, 41 words of descriptions |
| `caveman` | Compressed reply mode that cuts prose and keeps code and exact errors. The skill only; the author's hooks are not loaded. |  | 1 skill, 31 words of descriptions |

## Rough context cost

Counted words added to every session by the members above: about 522. This is the sum of skill description words and the session-start text that could be counted. It is a rough guide in words, not a measurement of tokens; tokens run somewhat higher than words.
0 members in this group have text that was not counted: hooks that add session text, or skills whose descriptions were not read. Harness mods add text for the model only where a figure appears above, plus short instructions some add when you trigger them.
Skill descriptions are what load at every session start. The body of a skill loads only when it is used. Third-party description counts come from the SKILL.md at the pinned commit.
