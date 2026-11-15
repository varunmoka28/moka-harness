<p align="center">
  <img src="assets/banner.svg" alt="reddit-watch: Surface Reddit posts that could improve your Claude Code use." width="100%">
</p>

## What it does

Watches subreddits you pick and shows the posts that could improve how you use Claude Code, in a side pane with links. By default it watches r/ClaudeCode posts with the "Built with Claude" flair. Claude's small model (Haiku) reads each new post once and keeps only the ones that give you something specific to try.

It is off after install. Nothing is fetched and no model is called until you type `/reddit on`.

- `/reddit on` turns it on and scans the latest posts now. It then checks again every hour while Claude Code is open.
- `/reddit off` turns it off. A check already under way stops before its next step; a request already sent to Haiku may still finish.
- `/reddit scan` checks for new posts now (only while watching is on).
- `/reddit` opens the side pane.
- `/reddit add <subreddit> [flair]` watches another subreddit, for example `/reddit add ClaudeAI Built with Claude`. `[flair]` is an optional label, typed without the brackets, that limits the watch to posts with it.
- `/reddit remove <subreddit>` stops watching one.
- `/reddit list` shows what is watched, whether it is on, and how many tokens Haiku has used.
- `/reddit clear` empties the list of posts shown in the pane.
- `/reddit reset` forgets which posts were already read and starts over; if watching is on, it re-reads them all, which costs tokens.

## What it needs

Claude Code 2.1.287 or newer. It uses only Claude Code's own features and plain web requests, so it should work wherever Claude Code runs; it has only been tried on macOS. No key or outside tool.

Install: `claude plugin install reddit-watch@moka-harness`.

## Hook events it uses

`session.start`, `command.run` (`/reddit`), `ui.render`.

## What it deletes or stops

Nothing is deleted. `/reddit off` stops its own hourly checks.

## What it sends off the machine

- Network: `www.reddit.com`, the public RSS feeds (Reddit's lists of new posts, no login). Nothing else.
- Model: the title and text of each new post goes to Haiku, one short call per post, each post read once, through your normal Claude connection. As a rough guide, reading 100 posts took about 29,000 input tokens and 1,900 output tokens.
- Files: it keeps its small saved state (settings, posts already read, posts shown) in the folder where Claude Code keeps its own settings. It does not touch your project files.

## Known limits

- It only knows the last 50 posts each feed returns. A busy subreddit can push a post out before the next check.
- Reddit may refuse requests when it is busy (error 429). The plugin says so and tries again at the next check.
- If the model fails to answer for a post three times, that post is skipped until it is forgotten or you run `/reddit reset`.
- It remembers the last 1500 posts it read. Watching more than about 30 subreddits at once can make it re-read old posts.
- With several Claude Code windows open, each checks on its own and pays for its own calls, and they save to the same place, so some posts may be read twice.
- Haiku's picks are a guess. Some good posts will be missed and some weak ones shown.

## License

MIT
