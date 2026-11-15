# Security

## Reporting a problem

If you find a security problem in a plugin under `plugins/`, or a pinned entry that points at a commit you believe is harmful, report it privately through [GitHub's private vulnerability reporting](https://github.com/varunmoka28/moka-harness/security/advisories/new). Please do not open a public issue for it.

Say which plugin or entry it is, what it does, and how to reproduce it.

## What is covered

- The plugins and scripts in this repo.
- The pins: an entry that installs something other than what its row in [docs/trust-table.md](../docs/trust-table.md) says.

A bug inside a third-party plugin or skill belongs in its author's repo. [CREDITS.md](../CREDITS.md) links each one. If the bug makes the pinned commit unsafe, tell me too and I will move or remove the pin.

## What to expect

This is one person's setup, kept in spare time. There is no response-time promise. [How far to trust this](../README.md#how-far-to-trust-this) says what the pins do and do not protect against.
