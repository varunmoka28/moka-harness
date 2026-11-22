# side-chat v2 design (2026-10-11)

What changes in `/btw` and why. Agreed with Varun in a brainstorm on 2026-10-11.

## Problems it fixes

- Right after `/clear` the pane answers `No reply (nothing-to-fork)`: there is no main transcript to fork.
- Answers draw as plain text, so markdown shows as raw `**` and backticks, and they are cut at 1200 characters.
- An answer cannot be copied or sent to the main chat.
- A thread is lost when it is cleared; old threads cannot be reopened.

## Layout: cards

```
Side chat · 3 saved (/history)                    [Clear] [Close]
/copy /draft /send [all] · /history /new · /model haiku|sonnet|opus|default
╭──────────────────────────────────────────────────────────────╮
│ what did it fix                fork  [Copy] [Draft] [Send]   │
│ It fixed the input cutting off long questions. (markdown)    │
╰──────────────────────────────────────────────────────────────╯
╭──────────────────────────────────────────────────────────────╮
│ (wrapped draft, when long or multi-line)                     │
│ Follow up...                                         ⏎ ask   │
╰──────────────────────────────────────────────────────────────╯
```

One bordered card per turn. Top row: the question, then the tag for how it was answered and three buttons. Body: a `Markdown` element, no length cap of our own (the engine's 10000-character limit applies, so the answer is sliced there).

## Behaviour

| Part | What it does |
|---|---|
| Answer path | `$.model.fork` as before. If it does not answer, `$.model.complete` on `haiku` with the side thread as the only context. The turn records `via: 'fork' \| 'haiku'`. |
| Copy | `$.process.run(['pbcopy'], { stdin })`. The header shows `Copied` until the next render that clears it. |
| Draft | `$.prompt.fill({ text, mode: 'append' })`, so what is already typed in the main prompt stays. |
| Send | `$.prompt.submit({ text })`; the engine runs it when the main session is idle. |
| Pane commands | `/copy`, `/draft`, `/send` act on the last answer; with `all` they act on the whole thread as `Q: … / A: …` text. `/new` saves the thread and starts an empty one. `/history` shows a `Select` of saved threads; a pick loads it. |
| History | `$.store` key `threads`: `{ id, started, title, turns }[]`, newest first, at most 30. The current thread is written after each answer. `title` is the first question, cut to 60 characters. |
| Kept | `@agent` calls, `/model`, `/clear`, `/close`, the wrapped draft inside the input border. |

`/clear` empties the current thread only; saved threads stay in history.

## v3 additions (2026-10-11)

| Part | What it does |
|---|---|
| Heading | A bold `Side chat` line at the top of the pane. |
| Context sent | Only the last 5 side turns go with each question. |
| Agent model | `@agent` calls run on `haiku` unless `/model` picks another (`default` means the agent's own). |
| Stop | Shown while thinking. The engine cannot cancel a fork or an agent, so Stop frees the pane and drops the late answer; the tokens are still spent. |
| Quick asks | Buttons under the thread when idle, labelled Doing? · Explain · Next?, sending What are you doing? · Explain that in plain words · What's next?. Short labels and a wrapping row keep them inside a narrow pane (0.4.4). |
| Folding | Answers over 12 lines show the first 12 and a `more (N lines)` button; `less` folds them again. |

## v4 ports from the built-in /btw (2026-11-21, 0.4.0)

Five features of the built-in `/btw` (docs: Interactive mode, "Side questions with /btw"). Normal answers and `@agent` calls stay read-only.

| Part | What it does |
|---|---|
| Context sent | Up to 20 earlier side turns go with each question (was 5). HISTORY_CHARS (8000) still caps the size, so long answers send fewer. |
| Tool calls as text | An answer that writes tool calls out as text (`<function_calls>`, `<invoke`, `<tool_use`, `<tool_call`) ends with a note that nothing was executed. Every answer path gets it. |
| `^name question` | Answers from that agent's transcript: `$.session.messages({ agentId })`, then one `$.model.complete` call with no tools. The engine cannot tell which transcript is open on screen, so the name is explicit. A name maps to the agent whose `name` matches (the name SendMessage uses), else whose `type` matches (`Explore`), else whose `id` matches; name and type ignore case, and the newest listed agent wins a tie. `$.agent.list()` drops a finished agent after a few seconds, and a transcript the session no longer holds comes back as a deny, which the pane shows. Model: the pane's `/model` (`default` runs haiku). Turn tag `transcript`. |
| Keys | Two routes reach a Pane. A Button `hotkey` (one digit or one lowercase letter) presses while the pane holds the focus; `c` is wired this way and copies the newest answer. Whether a hotkey fires while the cursor is in the pane's input is untested: if it does, typing c or f acts on the newest card, so check it in a live terminal before merging. Shift+Left/Right is reachable only through a `Client` element (a second surface module drawn inside the pane) whose `onKey` runs after a click gives it focus. A click is no faster than pressing a card's own Copy button, and every answer is already on screen, so Shift+Left/Right stepping is not built; v4.1 steps with Older and Newer buttons instead. |
| Fork button | A `Fork` button on each card, hotkey `f` on the newest. `$.agent.spawn({ subagentType: 'fork' })` runs in the background: it inherits the main conversation, gets the question and answer as its prompt, and has full tools (Varun's choice). It has full tools and runs in the same folder as the main session, so the two can edit the same file at once and neither sees the other's edits. The read-only guard skips it by its description `side chat fork`, which the agent list carries from the moment it runs; `@agent` agents stay blocked. The Agent tool's input docs name `subagent_type: "fork"` (forks always inherit the parent model). Its result is the engine's background-task notice; the mod does not track it. Not run against a live engine; a refusal shows in the pane header. The `f` hotkey has the same untested typing risk as `c`, and here it would start a full-tools agent: if it fires from the input, drop the hotkey and keep the button. |

Tests added: `history`, `toolnote`, `transcript`, `keys`, `fork` (one file each, in `hooks/`). The old "last 5 side turns" test in `v2.test.tsx` is replaced by `history`.

## v4.1 fixes (2026-11-21, 0.4.1)

| Part | What it does |
|---|---|
| `^name` after the agent ends | `$.agent.list()` drops a finished subagent within about a second, so `^name` used to fail with "No agent called". The mod now remembers each subagent's name, id and type at its `turn.start` and `turn.complete` (in memory, newest 50, emptied at session start) and resolves `^name` from the live list first, then from that memory. Only the link is kept, not the transcript: checked live on 2.1.330 with a scratch mod and an Explore subagent, `$.session.messages({ agentId })` kept returning the full transcript for the 72 seconds sampled after the agent left the list. One run and one agent type; if an engine stops reading finished agents, the pane shows the engine's deny, and the next step is to keep the text at `turn.complete` too. |
| Older and Newer | With two or more cards, a row above them holds `Older` (hotkey `o`), `Newer` (hotkey `n`) and a dim "card N of M". They select one card, with no wrap-around. The `c` (Copy) and `f` (Fork) hotkeys and a coloured border sit on the selected card, the newest by default; the selection keeps following the newest, and a new answer, `/new`, `/clear` and a history pick put it back there. `o` and `n` because `c` and `f` are taken and a hotkey is one digit or one lowercase letter. Pane-typed `/copy`, `/draft`, `/send` and `/now` still act on the last answer; the Draft, Send and Now buttons act on their own card. Whether a hotkey fires while the cursor is in the pane's input is still untested (see Keys above); for `o` and `n` the worst case is a card selection, not an action. |
| Quick asks | "Summarise the last reply" is now "Explain that in plain words". Since 0.4.4 the button is labelled "Explain" and sends the full question. |

Tests added: `agent-gone`, `stepping`.

## v4.2 fixes (2026-11-21, 0.4.2)

| Part | What it does |
|---|---|
| `Now` and subagent turns | `Now` appends a note to the main conversation when a main turn is running, and sends a message otherwise. It used to count the turn of every loop, so with main idle and a background subagent running it appended onto an idle main. Checked live on 2.1.330 with scratch mods: one append never starts a turn, and a note appended when no main request is coming is held and rides the next main turn, once. So the old route gave a note, and the second press (the first seemed to do nothing) gave a new turn that carried it: the text reached main twice. Only turns with no `agentId` count now. Not reproduced end to end live: the route is shown by a mock test and the engine facts by the probes. Still open: a `Now` pressed in the last moments of a main turn, after its last model request, is held and joins the next turn, once and late. |
| A pending answer and a thread reset | A request is tagged by `round` when it starts and drops its answer if `round` has moved. `/clear`, `/new` and picking a thread in `/history` now call `stop()`, which moves it, so an answer still on its way no longer lands in the new thread. The haiku fallback is cancelled through the AbortController signal passed to `$.model.complete`; a fork cannot be cancelled, so its late answer is dropped. Keep the `stop()` calls. |

Tests added: `now-route`, `clear-pending`.

## v4.3 additions (2026-11-21, 0.4.3)

| Part | What it does |
|---|---|
| As-of stamp on fork answers | A `turn.step` hook records the main loop's latest request (`e.index`, counted from 0, no `agentId`). `ask()` reads it just before `$.model.fork` starts and puts `as of step N · ` at the front of the card's dim cost line, with N counted from 1. The fork answers from the main thread's last model request, so mid-turn it does not see tool results that arrived after it; the stamp shows how far main had got. It is shown only while a main turn runs: `turn.start` and `turn.complete` of the main loop clear it. A subagent's steps never move it. The Haiku fallback and `^name` answers carry no stamp. It rides the cost string, so `SideTurn` and saved threads are unchanged. |
| Tool names in the fallback context | When the fork does not answer, Haiku reads the main conversation's text from `$.session.messages()`. Each row now ends with `[tools: A, B]` (names de-duplicated, in first-seen order), and a tool-only row reads `assistant: [tools: Read]`. Tool inputs and results never go in, because a result can be huge or private. The `TRANSCRIPT_CHARS` tail cap is unchanged. The `^name` path is unchanged: it already reads that agent's tool calls and results. |

Tests added: `step-stamp`, `fallback-tools`.

## Tests

One small file per feature, run with `claude plugin test`:

- fallback: a fork that does not answer gets a Haiku answer tagged `haiku`
- copy: Copy runs `pbcopy` with the answer as stdin
- draft and send: the buttons call `prompt.fill` and `prompt.submit` with the answer
- history: a thread saved by `/new` comes back through the `/history` pick
- the existing five tests keep passing

## v4.4 (0.4.4): narrow panes

- A card's Copy, Draft, Send, Now and Fork buttons have their own wrapping row under the question. On one row with the question, a terminal under about 170 columns dropped them all, so Fork could not be pressed.
- The quick asks are labelled Doing?, Explain and Next? and their row wraps; each still sends its full question.

## v4.5 (0.4.5): coloured card actions

- Copy (cyan), Draft (blue), Send (green), Now (yellow) and Fork (magenta) are drawn as coloured pills: plain Buttons holding a Text with a background colour, so each action reads at a glance. Fork is magenta because it starts an agent with full tools. Keys, hotkeys (c, f) and presses are unchanged.

## v4.6 (0.4.6): prompt-only answers

- When a side question asks for a prompt (to give, write or send), the instructions sent with every side question (fork, Haiku fallback and ^name, all built by buildPrompt) tell the model to answer with only the prompt text: no intro, explanation or closing line, and the 6-line limit does not apply. Test: hooks/prompt-only.test.tsx.

## v4.7 (0.4.7): Now removed (2026-11-22)

- The Now button and /now are gone, with the turn tracking only they used. Live probe 2026-11-22 (Haiku, main turn waiting on a background agent): Now's note was read only when the agent finished, about 2 minutes later, so it did nothing Send does not. Send is unchanged: its prompt queues behind a running main turn and runs when the session is idle. Tests: now-route removed; v2 checks a card has Send and no Now.
