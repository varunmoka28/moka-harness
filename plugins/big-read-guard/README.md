# big-read-guard

## What it does

Refuses a whole-file `Read` of a text file over 50 KB and tells Claude to grep the file or read a range with `offset` and `limit`, so a big file does not ride along in every later request. A `Read` that names both `offset` and `limit` always goes through. To read a big file on purpose, the refusal message gives the exact `offset: 1, limit: <lines>` to use. Skipped file endings: `.png .jpg .jpeg .gif .webp .pdf .ipynb`, plus any you list.

An A/B run of 6 big-file tasks (3 runs each way, Sonnet) found no token difference, because Claude almost never read a whole big file when asked a pointed question; the guard never fired in those runs. It is a safety net, not a measured saving.

## What it needs

`awk` (to count lines). Optional skip list in `~/.claude/big-read-guard.json`, as `{"skip": [".log"]}`. That path is fixed to `~/.claude` even if `CLAUDE_CONFIG_DIR` points elsewhere.

## Hook events it uses

`session.start`, and `tool.call` on `Read`.

## What it deletes or stops

It stops (refuses) one kind of tool call: an unranged `Read` of a text file over 50 KB. It deletes nothing.

## What it sends off the machine

Nothing. It reads file size with `stat` and counts lines with `awk`, locally.
