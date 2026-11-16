# web-access

A skill that decides how to get something from the live web: search, read a page, crawl a site, pull fields from a page, or get data from a platform such as X, LinkedIn or Reddit.

## What it does

It starts with free search and page fetch, and uses the rest of the treg catalogue only for pages and platforms a free fetch cannot reach. Nothing runs locally: no browser, no cookies.

## What it needs

The `treg` entry from this marketplace, and a treg account. Without a key the skill has nothing to call.

## Hook events it uses

None. It is a skill.

## What it deletes or stops

Nothing.

## What it sends off the machine

The search terms and URLs you ask about go to treg and the vendors it routes to. Some treg tools are paid.
