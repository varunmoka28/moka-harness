# side-chat v2 design

What changes in `/btw` and why.

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

## v3 additions

| Part | What it does |
|---|---|
| Heading | A bold `Side chat` line at the top of the pane. |
| Context sent | Only the last 5 side turns go with each question. |
| Agent model | `@agent` calls run on `haiku` unless `/model` picks another (`default` means the agent's own). |
| Stop | Shown while thinking. The engine cannot cancel a fork or an agent, so Stop frees the pane and drops the late answer; the tokens are still spent. |
| Quick asks | Buttons under the thread when idle: What are you doing? · Summarise the last reply · What's next? |
| Folding | Answers over 12 lines show the first 12 and a `more (N lines)` button; `less` folds them again. |

## Tests

One small file per feature, run with `claude plugin test`:

- fallback: a fork that does not answer gets a Haiku answer tagged `haiku`
- copy: Copy runs `pbcopy` with the answer as stdin
- draft and send: the buttons call `prompt.fill` and `prompt.submit` with the answer
- history: a thread saved by `/new` comes back through the `/history` pick
- the existing five tests keep passing
