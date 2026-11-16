# Changelog

Every change to a pinned commit of a third-party entry gets a line here naming the entry.

## Unreleased

## v0.2.0 (2026-11-16)

- Fixed clean-view: plan_steps and report_progress now read their arguments from the event, so its tool gate no longer denies every tool.
- Catalogue page on GitHub Pages (https://varunmoka28.github.io/moka-harness/), built from the marketplace by `scripts/build_catalogue.py`, with screenshots on nine entries.
- README shortened, with a banner, a plug icon and a request to install herdr first.
- The plugins in `plugins/` are called harness plugins, since most started from mods other people published.

## v0.1.0 (2026-11-15)

First release.

- Removed the `office-files` entry (docx, pdf, pptx, xlsx from anthropics/skills), pinned at `9d2f1ae187231d8199c64b5b762e1bdf2244733d`.
- Removed the `homunculus` entry (humanplane/homunculus), pinned at `59b6520f3b31fc5c31e57f7ffa3e7fee28a365c4`, and the `memory` bundle that held only it.
- Marketplace build, pin check, pin changelog check, credits generator, public export and CI checks added.
