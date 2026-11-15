# cloud

AWS skills and an AWS MCP server. Needs an AWS account and credentials.

## Members

- `aws-core`: AWS agent toolkit core plugin: AWS skills plus the author's MCP servers and hooks.

## What it needs

Needs an AWS account and credentials.

## MCP servers

- `aws-mcp`: AWS MCP through `mcp-proxy-for-aws` 1.8.0. Runs through uvx, signs with the AWS profile you set.

Secrets are asked for when you enable the plugin and are never written to this repository.
