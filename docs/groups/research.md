# Group: research

Paper search, web and video reading, and research skills.

Install: `claude plugin install research@moka-harness`

To install less, install single members by name, for example `claude plugin install reddit-watch@moka-harness`.

## Needs

A free alphaXiv account for the paper search server; ffmpeg and yt-dlp for `watch`.

The bundle also carries these MCP servers, started when the bundle is enabled:

- `alphaxiv`: http https://api.alphaxiv.org/mcp/v1

## Members

| Member | What it is | Needs | Rough context cost |
|---|---|---|---|
| `reddit-watch` | Watches subreddits you choose, has Claude's small model (Haiku) pick out posts that could improve your Claude Code use, and lists them with links in a side pane. Off until you turn it on. Contacts reddit.com and sends post text to Haiku once you run /reddit on; off until then. | Nothing; off until /reddit on | no always-on text found in its hooks |
| `watch` | Lets Claude watch a video from a link or file: frames, captions or Whisper transcript. Needs ffmpeg and yt-dlp. | ffmpeg and yt-dlp | 1 skill, 40 words of descriptions; plus hook text not counted |
| `k-dense-science` | K-Dense scientific skills: literature review, scientific writing, data access, plotting and peer review. |  | 21 skills, 1001 words of descriptions |
| `orchestra-research` | Orchestra Research's autoresearch skill: runs autonomous research projects as an inner experiment loop and an outer steering loop. |  | 1 skill, 70 words of descriptions |
| `book-to-skill` | Converts a book or document into a structured agent skill. | See author repo | 1 skill, 63 words of descriptions |
| `anysearch` | Specialist search for finance, legal, code, security, academic and other domain queries, for when native web search is not enough. | See author repo | 1 skill, 16 words of descriptions |
| `agent-reach` | Lets an agent search or read the web, Twitter/X, Reddit, YouTube, GitHub and more. | See author repo | 1 skill, 15 words of descriptions |
| `graphify` | Turns code, documents, papers and images into a knowledge graph with an HTML report. | See author repo | 1 skill, 19 words of descriptions |
| `big-arrow` | Points at a spot on the user's macOS screen with the bigarrow command-line tool. | See author repo | 1 skill, 109 words of descriptions |
| `supabase-skills` | Supabase's skills for Supabase and Postgres best practice. |  | 2 skills, 219 words of descriptions |

## Rough context cost

Counted words added to every session by the members above: about 1,552. This is the sum of skill description words and the session-start text I could count. It is a rough guide in words, not a measurement of tokens; tokens run somewhat higher than words.
1 member in this group has text that was not counted: hooks that add session text, or skills whose descriptions I did not read. Own mods add text for the model only where a figure appears above, plus short instructions some add when you trigger them.
Skill descriptions are what load at every session start. The body of a skill loads only when it is used. Third-party description counts come from the SKILL.md at the pinned commit.
