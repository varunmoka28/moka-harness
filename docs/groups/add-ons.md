# Add-ons

Three entries sit outside every group. Install each by name on its own.

| Entry | What it is | Needs |
|---|---|---|
| `fork-cleanup` | Off by default. Deletes stale forks from your own GitHub account; dry-run until switched on. | gh signed in with delete_repo scope; off by default |
| `gstack` | Garry Tan's skill set: browse, QA, review, ship, retro and more. Needs the author's own binary for the browser skills. | The author's own binary for the browser skills |
| `treg` | treg: external and live data and generative models behind one tool catalogue. Needs a treg account. | A treg account (paid) |

`fork-cleanup` is `defaultEnabled: false`. See [known risks](../known-risks.md) before turning it on. `treg` is paid and talks to the treg service.
