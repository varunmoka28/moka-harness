# layman

## What it does

Gives plain-language replies when you ask for them. Say "layman", "I'm lost", "I didn't understand" or "explain again" and the next reply uses everyday words, one idea and one real example. Ask twice in a session and plain mode stays on; `/layman on`, `/layman off` or `/layman` switches it by hand. A short message that asks to explain a contract, lease, offer letter or similar document gets a fixed five-part breakdown (summary, red flags, unusual terms, missing protections, questions to ask).

## What it needs

Nothing beyond Claude Code with mod support. The count of asks is kept in session state under `layman.asks`; the `cache-clock` plugin reads it.

## Hook events it uses

`session.start` (registers `/layman`), `command.run` (`/layman`), `prompt.submit`.

## What it deletes or stops

Nothing.

## What it sends off the machine

Nothing of its own. When a message matches, it adds a short instruction to that prompt's context, which goes to the model with the rest of your conversation as usual. It makes no model call and no network call.
