# Group: memory

The homunculus plugin. Claude Code's own memory needs no install.

Install: `claude plugin install memory@moka-harness`

To install less, install single members by name, for example `claude plugin install homunculus@moka-harness`.

## Needs

Nothing extra. It holds homunculus; Claude Code's built-in memory needs no install.

## Members

| Member | What it is | Needs | Rough context cost |
|---|---|---|---|
| `homunculus` | Watches your sessions, learns small patterns as instincts and can grow them into skills. Needs nothing beyond Claude Code. | Nothing | 2 skills, 32 words of descriptions; plus hook text not counted |

## Rough context cost

Counted words added to every session by the members above: about 32. This is the sum of skill description words and the session-start text I could count. It is a rough guide in words, not a measurement of tokens; tokens run somewhat higher than words.
1 member in this group has text that was not counted: hooks that add session text, or skills whose descriptions I did not read. Own mods add text for the model only where a figure appears above, plus short instructions some add when you trigger them.
Skill descriptions are what load at every session start. The body of a skill loads only when it is used. Third-party description counts come from the SKILL.md at the pinned commit.
