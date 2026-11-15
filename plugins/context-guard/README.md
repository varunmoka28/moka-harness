# context-guard

Warns when a conversation's context grows large, because every request re-sends the whole context and each further turn gets more expensive.

## What it does

When the context passes 150K tokens it shows a toast suggesting you save your place and clear, or run `/compact`, before the next task. It warns again every further 100K tokens. A compaction or `/clear` that shrinks the context re-arms the warning. Headless runs (`claude -p`) are never warned.

Optional, off by default: with the environment variable `CONTEXT_GUARD_AUTO_COMPACT=1`, a session that is idle for 10 minutes with a context over 150K tokens compacts itself. Compacting replaces the conversation history with a summary and spends model tokens, which is why it is opt-in.

## What it needs

Claude Code with mods enabled. No outside binary or key. The toast mentions `/park`, a command from the `park` plugin; it works without it.

## Hook events it uses

`session.start`, `session.end`, `prompt.submit`, `turn.start`, `turn.complete`.

## What it deletes or stops

Nothing, unless you set `CONTEXT_GUARD_AUTO_COMPACT=1`. Then an idle, large session is compacted: its history is replaced by a summary. The compaction is shown in a toast, or the reason it was skipped.

## What it sends off the machine

Nothing of its own. With auto-compact on, the compaction is an ordinary model call in your session, the same as running `/compact`.

## Install

```
claude plugin marketplace add varunmoka28/moka-harness
claude plugin install context-guard@moka-harness
```

## License

MIT.
