<p align="center">
  <img src="assets/banner.svg" alt="disk-sweep: Warn when disk space runs low and sweep stale Claude Code data." width="100%">
</p>

**macOS only.** On Linux and Windows the plugin does nothing and shows no errors.

## What it does

Warns when your Mac is running low on disk space and, when you type `/disk`, lists old Claude Code leftovers you can tick and delete. Claude Code keeps old plugin versions, conversation transcripts, file backups and debug logs in its config folder, and they pile up over months.

- Below 30 GB free, a line like `25.0G free · /disk` shows in the status area, plus one pop-up note per day.
- `/disk` scans and lists what could be removed. `/disk --days 30` changes how old a transcript must be to be listed (default 14 days).
- A panel appears above the prompt. Press **Tick** on the rows you want, or **Tick all safe**. **Remove ticked** asks you to press again; the second press rescans, then acts only on what is still there. **Dismiss** closes the panel.

### It deletes nothing until you set it up

The plugin starts in dry-run mode. Two options, both in the plugin's configuration, gate deletion:

- `dryRun` (default on): Remove ticked only reports and logs what it would delete.
- `deleteRoots` (default empty): comma-separated Claude config folders under your home folder, `~` allowed, for example `~/.claude`. Only paths under these folders are ever deleted; anything else is skipped and logged. With an empty list nothing is deleted, even with `dryRun` off. The plugin never guesses a folder for you.
- `alsoSweep` (default empty): more config folders to scan along with this session's, for example `~/.claude-work`. Scanning only lists; deleting still needs `deleteRoots`.

Every action goes to `${CLAUDE_PLUGIN_DATA}/disk-sweep.log`: what it would remove, what it is removing, what it removed or failed on, and what it skipped. If the log cannot be written, nothing is deleted.

### What it can list

| Kind | What | Rule |
|---|---|---|
| safe | Old plugin versions in `plugins/cache/` | Not the installed version, a newer version is installed, and it is 1 day past Claude's own "orphaned" mark or 7 days untouched |
| safe | Leftover plugin download folders (`temp_git_*`, `temp_subdir_*`) | Older than 1 day |
| safe | `file-history/` files | Older than 30 days |
| safe | `debug/` files | Older than 7 days |
| look | Conversation transcripts in `projects/` | Older than the cutoff, one row per project. Deleted transcripts can no longer be resumed. |

Anything else in your Claude folder (memory, plans, skills, settings, marketplaces) is never listed.

## What it needs

macOS (it uses the BSD `df`, `find`, `stat` and `du`), and Claude Code 2.1.287 or newer. `CLAUDE_CONFIG_DIR` must be a folder inside your home folder; otherwise `~/.claude` is scanned. No key or outside tool.

Install: `claude plugin install disk-sweep@moka-harness`.

## Hook events it uses

`session.start`, `command.run` (`/disk`), `ui.render`.

## What it deletes or stops

With `dryRun` off and a folder in `deleteRoots`, the rows you tick and confirm are removed with `rm -rf`, which cannot be undone. Only stale plugin versions, temporary plugin clones, `file-history`, `debug` and `projects` transcripts inside the listed folders are ever candidates. It never deletes without two presses from you. It stops nothing.

## What it sends off the machine

Nothing. No network, no model calls. It runs `df`, `find`, `stat`, `du`, `uname`, `test` and `rm` locally, reads your config folder and `plugins/installed_plugins.json`, and writes its log under `${CLAUDE_PLUGIN_DATA}`.

## Known limits

- The 30 GB warning level is fixed.
- The log location comes from `CLAUDE_PLUGIN_DATA`; if Claude Code does not set it for the plugin, nothing is deleted.

## License

MIT
