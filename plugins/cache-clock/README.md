# cache-clock

Shows above the prompt how many minutes are left before the prompt cache goes cold, with a button to compact the conversation.

## What it does

Claude Code keeps the start of a conversation in a prompt cache so repeat requests are cheaper. When the cache goes cold the next request re-sends everything at full price. This mod draws a countdown bar above the prompt, turns it yellow with 10 minutes left, and shows a toast at 5 minutes. A running turn refreshes the cache on every request, so the countdown only counts down between turns. A button compacts the conversation, which starts a new short prefix and resets the clock. Under the bar one line shows notes from the `unattended` and `layman` plugins.

The cache lifetime defaults to 60 minutes (a subscription). On API billing or in usage overage it is 5 minutes: set the environment variable `CACHE_CLOCK_TTL_MINUTES=5` to match.

There is a similar plugin, `cache-tax`, in this marketplace. They overlap; install the one you prefer.

## What it needs

Claude Code with mods enabled. It declares `unattended` and `layman` as dependencies and reads their state (`unattended.on`, `layman.asks`), so installing it installs both from this marketplace. No outside binary or key.

## Hook events it uses

`session.start`, `turn.start`, `turn.complete`, `session.compact`, `ui.render` (above the prompt).

## What it deletes or stops

Nothing. The compact button, when you press it, replaces the conversation history with a summary, the same as `/compact`.

## What it sends off the machine

Nothing of its own. Pressing the compact button is an ordinary model call in your session.

## Install

```
claude plugin marketplace add varunmoka28/moka-harness
claude plugin install cache-clock@moka-harness
```

## License

MIT.
