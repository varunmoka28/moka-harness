# fork-cleanup

**This plugin deletes repositories from your GitHub account, and a deleted repository cannot be undone.** It is off by default and starts in dry-run mode.

## What it does

When a session starts, it lists the forks in the GitHub account you name and removes the stale ones. A fork is stale only if all of these hold:

- it belongs to the account you set;
- it was created at least the number of days you set (default 90);
- it has a single branch and no commits that are missing from its parent repository;
- it is not on your keep list;
- the account is the one `gh` is signed in as (an organisation name is refused).

Until you turn on "Delete for real", it only writes what it would delete to the log. With no account set, it does nothing and makes no call to GitHub.

## What it needs

- The `gh` command, signed in to the account you name, with permission to delete repositories (`gh auth refresh -s delete_repo`).
- `jq` is built into `gh`; nothing else to install.
- Settings (asked when you enable the plugin): `github_account`, `delete_forks` (default off), `min_age_days` (default 90), `keep` (comma-separated, `owner/name` or `name`).

## Hook events it uses

`SessionStart`.

## What it deletes or stops

GitHub forks that meet every condition above, and only when `delete_forks` is on. Nothing else. It never touches repositories that are not forks, forks of other accounts, or anything on your machine.

Every decision (skipped, would delete, deleted, failed) is appended to `fork-cleanup.log` in the plugin's data folder (`${CLAUDE_PLUGIN_DATA}`). Read that log in dry-run first.

## What it sends off the machine

Requests to GitHub through `gh`: a list of your forks, a read of each old fork, a comparison with its parent, and a delete request when switched on. Nothing goes anywhere else.
