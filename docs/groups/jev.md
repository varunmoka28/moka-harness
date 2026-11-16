# Group: jev

Mods and a skill that call the TypeSafe (Jev) service. They do nothing without a key.

Install: `claude plugin install jev@moka-harness`

To install less, install single members by name, for example `claude plugin install prompt-enhancer@moka-harness`.

## Needs

A TypeSafe (Jev) API key, paid per call.

## Members

| Member | What it is | Needs | Rough context cost |
|---|---|---|---|
| `prompt-enhancer` | Rewrite a rough prompt in place using project rules and Jev-ranked skills. Needs a TypeSafe API key; calls are paid. | TypeSafe key, python3 | no always-on text found in its hooks |
| `run-ledger` | Estimated API cost per run, model and plugin, subagent status, and optional Jev model advice. Jev advice needs a TypeSafe API key; calls are paid. | TypeSafe key for recommend and auto-route | no always-on text found in its hooks |
| `typesafe` | Skills for designing workflows with the TypeSafe System One API and finding its current docs. Needs nothing to install. | A TypeSafe key to use what it describes | 1 skill, 95 words of descriptions |

## Rough context cost

Counted words added to every session by the members above: about 95. This is the sum of skill description words and the session-start text that could be counted. It is a rough guide in words, not a measurement of tokens; tokens run somewhat higher than words.
0 members in this group have text that was not counted: hooks that add session text, or skills whose descriptions were not read. Harness mods add text for the model only where a figure appears above, plus short instructions some add when you trigger them.
Skill descriptions are what load at every session start. The body of a skill loads only when it is used. Third-party description counts come from the SKILL.md at the pinned commit.
