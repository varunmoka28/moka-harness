# Group: media

Skills for making images, video and short clips.

Install: `claude plugin install media@moka-harness`

To install less, install single members by name, for example `claude plugin install hyperframes@moka-harness`.

## Needs

Some skills need a paid image or video key.

## Members

| Member | What it is | Needs | Rough context cost |
|---|---|---|---|
| `hyperframes` | HeyGen's HyperFrames: write HTML, render video. The plugin loads the author's whole skill set. | See author repo; some skills need paid keys | 7 skills, 320 words of descriptions |
| `gpt-image-2` | Image generation and editing skill for GPT Image 2, with prompt templates. Text is mostly in Chinese. | An image-model key | 1 skill, 51 words of descriptions |
| `make-ugc` | treg's make-ugc workflow: short user-style videos. Needs a treg account. | A treg or paid media key may be needed | 1 skill, 79 words of descriptions |

## Rough context cost

Counted words added to every session by the members above: about 450. This is the sum of skill description words and the session-start text that could be counted. It is a rough guide in words, not a measurement of tokens; tokens run somewhat higher than words.
0 members in this group have text that was not counted: hooks that add session text, or skills whose descriptions were not read. Harness mods add text for the model only where a figure appears above, plus short instructions some add when you trigger them.
Skill descriptions are what load at every session start. The body of a skill loads only when it is used. Third-party description counts come from the SKILL.md at the pinned commit.
