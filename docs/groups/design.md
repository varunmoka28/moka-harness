# Group: design

Diagram, UI and design skills, plus the mod that opens HTML design previews in a browser.

Install: `claude plugin install design@moka-harness`

To install less, install single members by name, for example `claude plugin install design-direction@moka-harness`.

## Needs

Nothing. `design-direction` is macOS only.

## Members

| Member | What it is | Needs | Rough context cost |
|---|---|---|---|
| `design-direction` | Shows design-direction options as rendered mockups in the browser. macOS only (uses open). | macOS | a 98-word guide on design previews |
| `diagram-design` | Draws diagrams (architecture, flowcharts, sequence, ER and more) as self-contained HTML and SVG. Needs nothing. |  | 1 skill, 114 words of descriptions |
| `diagram-pane` | A side pane that pins every diagram Claude draws and keeps a live map of the work. Needs Claude Code 2.1.287 or newer. |  | hook text not counted |
| `impeccable` | Design commands for frontend work: critique, audit, polish and anti-pattern checks. Needs nothing. | Nothing | 1 skill, 81 words of descriptions; plus hook text not counted |
| `modern-web-guidance` | Keeps Claude current on modern web best practices, including a Chrome extensions skill. Needs nothing. |  | 2 skills, 217 words of descriptions |
| `diagram-skills` | Diagram skills: ArchiMate, BPMN, UML, architecture, network, cloud, Graphviz, Vega and others. |  | 14 skills, 639 words of descriptions |
| `fireworks-tech-graph` | Draws technical diagrams from a description and exports SVG and PNG. |  | 1 skill, 48 words of descriptions |
| `anatomy` | Builds detailed interactive isometric SVG figures that explain a technical idea as a physical object. |  | 1 skill, 162 words of descriptions |
| `awwwards` | Builds award-level websites from a one-line prompt: concept, type, motion, checks. |  | 1 skill, 112 words of descriptions |
| `frontend-design` | Anthropic's frontend design skill. |  | 1 skill, 53 words of descriptions |
| `accessibility` | Web accessibility checks against WCAG 2.2. The plugin loads the author's other web-quality skills too. |  | 6 skills, 189 words of descriptions |
| `reanimate` | Clones a section, widget or animation from a reference site or recording into your own code, frame by frame, then checks it. |  | 1 skill, 178 words of descriptions |
| `blank-page` | Turns a one-line motion or design brief into a full prompt with references, beats and attached assets. |  | 1 skill, 81 words of descriptions |
| `infographics` | Creates infographics with image-generation models and iterative review. Needs the author's API keys. |  | 1 skill, 37 words of descriptions |

## Rough context cost

Counted words added to every session by the members above: about 2,009. This is the sum of skill description words and the session-start text that could be counted. It is a rough guide in words, not a measurement of tokens; tokens run somewhat higher than words.
2 members in this group have text that was not counted: hooks that add session text, or skills whose descriptions were not read. Harness mods add text for the model only where a figure appears above, plus short instructions some add when you trigger them.
Skill descriptions are what load at every session start. The body of a skill loads only when it is used. Third-party description counts come from the SKILL.md at the pinned commit.
