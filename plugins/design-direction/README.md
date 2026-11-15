# design-direction

Pick a design direction by sight.

## What it does

When Claude asks you to choose between visual designs and the option previews are HTML, this writes each page to a file, opens it in your browser and replaces the preview in the question with a note giving the file path.

macOS only: it opens pages with the `open` command.

## What it needs

macOS (`open`) and a browser. Claude Code with plugin mods support.

## Hook events it uses

`prompt.compose` (adds a short guide on design previews) and `tool.call` on `AskUserQuestion`.

## What it deletes or stops

It deletes its own HTML files in `/tmp/design-direction` once they are a day old (`rm -f`, matching the pattern `<number>-<number>.html` only). It touches no other file.

## What it sends off the machine

Nothing. The pages are local files with no network use.
