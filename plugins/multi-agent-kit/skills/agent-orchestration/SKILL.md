---
name: agent-orchestration
description: How to split work between agents so each one can succeed and you can check it. Use when planning to hand work to subagents, parallel sessions or other CLIs.
user-invocable: false
---

# Splitting work between agents

An agent starts with none of your context and returns one summary. Hand it work it can finish and you can check, and keep your own context for decisions.

## When to hand work off

Hand off work that needs many files read, many edits, or a test run: the agent spends its own context on it and you receive a short result. Do small things yourself: a one-line fix or a config tweak costs less than writing the brief.

Don't read files in your own session just to describe them to an agent. Name the task and where to look; it reads what it needs.

## Where the agents run

- **Ask every time.** Before the first hand-off of a task, ask the user whether to run the agents as tuios windows or as subagents inside this session. Never pick for them, even when an earlier task used tuios.
- **tuios view in the caller's space.** When the user picks tuios, show the tuios view in the herdr space this session runs in. In the Herdr app (`HC_TERMINAL_ID` set), use `herdr-core run`. With the herdr CLI, reuse or create the `agents (tuios)` tab in the current workspace. If neither is running, ask the user where to show it. Never open a separate Terminal window.
- The launch steps (session, one worktree per window, auto mode, attach, short prompt) are in this plugin's README under "Running agents in tuios".

## The brief

- **One task per agent.** If the brief has an "and" joining two outcomes, make two briefs.
- **Own files.** Say which files or folders the agent may change. Two agents never edit the same file.
  - With `merge-gate` installed, record them as `git config branch.<branch>.scope "<paths>"` (space-separated; a trailing `/` marks a folder), so a merge outside them is refused.
- **A named check.** Give the command or condition that proves the work is done (a test, a build, a diff to compare). An agent without one reports "done" on its own judgment.
- **Own worktree when parallel.** Agents running at the same time each get their own git worktree and branch, so they cannot overwrite each other or leave your tree half-edited.
- **Brief in a file.** Write the task to a file and point the agent at it. A file can be re-read, reviewed and reused after a restart; a long pasted prompt cannot.
- **Result in a file.** Ask the agent to write its report to a named path (what it changed, what the check printed, what it could not do), so you read the result without replaying the session. A last line such as `STATUS: done` or `STATUS: blocked` lets a script or hook see the outcome.

## After it finishes

Run the named check yourself before accepting the result. Read the report for what the agent skipped or could not do. Merge one branch at a time and re-run the check after each merge, so a failure points at one change.

## Other CLIs

Another CLI (Codex, agy, and so on) does not load this project's CLAUDE.md or hooks. Point its brief at the rule files it needs.
