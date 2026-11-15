# Group: cloud

AWS skills and the AWS MCP server.

Install: `claude plugin install cloud@moka-harness`

To install less, install single members by name, for example `claude plugin install aws-core@moka-harness`.

## Needs

An AWS account and credentials.

The bundle also carries these MCP servers, started when the bundle is enabled:

- `aws-mcp`: uvx mcp-proxy-for-aws@1.8.0 https://aws-mcp.us-east-1.api.aws/mcp --metadata INSTALL_SOURCE=aws-cli

## Members

| Member | What it is | Needs | Rough context cost |
|---|---|---|---|
| `aws-core` | AWS agent toolkit core plugin: AWS skills plus the author's MCP servers and hooks. | AWS account and credentials | 27 skills, 2695 words of descriptions; plus hook text not counted |

## Rough context cost

Counted words added to every session by the members above: about 2,695. This is the sum of skill description words and the session-start text I could count. It is a rough guide in words, not a measurement of tokens; tokens run somewhat higher than words.
1 member in this group has text that was not counted: hooks that add session text, or skills whose descriptions I did not read. Own mods add text for the model only where a figure appears above, plus short instructions some add when you trigger them.
Skill descriptions are what load at every session start. The body of a skill loads only when it is used. Third-party description counts come from the SKILL.md at the pinned commit.
