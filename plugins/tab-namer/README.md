# tab-namer

Needs [herdr](https://herdr.dev), in a terminal or as the Herdr desktop app. Names your herdr tab, and the workspace it sits in, after the task you start working on.

## What it does

With several Claude Code sessions open in herdr, every tab is just a number. This gives each tab a short name from your first request. If you start with "please fix the login page bug and rerun the tests", the tab becomes "fix the login page bug". The workspace gets the same name, as long as it still has the name herdr gave it (its folder name). In the Herdr desktop app the workspace is called a space, and it works the same way.

Nothing to do for the first name: it happens on your first request in a session. A slash command counts too, using what you typed after it.

- `/tab-namer` shows whether relabelling is on or off.
- `/tab-namer on` turns relabelling on. After the first turn, and then every third request, Haiku reads your recent requests and Claude's last reply, and renames the tab if the task has moved.
- `/tab-namer off` turns it off again.

## What it needs

Claude Code 2.1.287 or newer, and [herdr](https://herdr.dev), the terminal tool whose tabs it names. In the Herdr desktop app it uses the `herdr-core` command the app installs. Without herdr (or when herdr does not answer) it runs nothing, writes nothing and shows no error. Only tried on macOS.

Install: `claude plugin install tab-namer@moka-harness`.

## Hook events it uses

`session.start`, `command.run` (`/tab-namer`), `prompt.submit`, `turn.complete`.

## What it deletes or stops

Nothing. It renames the current tab and its workspace in herdr, never another tab. A tab you named yourself, or renamed after the plugin named it, is left alone, and so is a workspace with a name of your own.

## What it sends off the machine

Nothing leaves your machine except Claude's own model call, and only when relabelling is on: one short Haiku call (a few hundred tokens) after the first turn and then after every third request, carrying your last few requests and the start of Claude's last reply. The first-request name needs no model. It saves one setting (relabelling on or off) in Claude Code's own settings folder.

## Known limits

- A workspace counts as unnamed only while its name is the folder name of the folder Claude was started in. With several sessions in one workspace, the first one to name it keeps it.
- Names are at most 40 characters and about five words.
- In the Herdr desktop app the names live in the app's own state (the `herdr-app` document in `herdr-core`), which the app does not document. Tried with herdr-core 0.1.21; a later app version may store them differently, and then the mod names nothing.
- When herdr runs inside a Herdr desktop app terminal, the herdr tab is named, not the app's space.
- Relabelling is a guess by a small model and can be off.
- The first name comes from your words as typed, so a vague first request gives a vague name.

## License

MIT
