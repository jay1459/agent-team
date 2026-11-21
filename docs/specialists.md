# Specialists

Specialists are agents that know one service well. Turn them on in the UI's Specialists tab or in
`team.json`:

```jsonc
"specialists": [
  { "id": "azure", "enabled": true, "mcp": true },   // catalog specialist, with its MCP server
  { "id": "dynamics365", "enabled": true },           // catalog specialist, docs only
  {
    "id": "custom:twilio",                            // your own
    "enabled": true,
    "title": "Twilio",
    "description": "SMS and WhatsApp messaging through Twilio.",
    "docs": ["https://www.twilio.com/docs/messaging"],
    "mcp": { "command": "npx", "args": ["-y", "some-twilio-mcp"], "env": { "TWILIO_AUTH_TOKEN": "env:TWILIO_AUTH_TOKEN" } }
  }
]
```

Each becomes `.claude/agents/<id>-specialist.md`. The PM sees it in its roster and brings it in
when a task needs that knowledge.

## Catalog

| id               | Knows                                                       | MCP server (`"mcp": true`)                                      | Needs                                                                      |
| ---------------- | ----------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `azure`          | Azure services, identity, networking, cost, Bicep/Terraform | Azure MCP Server (`npx @azure/mcp`)                             | `az login`                                                                 |
| `dynamics365`    | Dynamics 365 apps, Dataverse, plug-ins, solutions, ALM      | Dataverse proxy (`npx @microsoft/dataverse mcp $DATAVERSE_URL`) | `DATAVERSE_URL`; Dataverse MCP enabled by an admin                         |
| `power-platform` | Power Apps, Power Automate, Power BI, Copilot Studio        | Microsoft Learn docs (`learn.microsoft.com/api/mcp`)            | Nothing                                                                    |
| `microsoft-365`  | Graph, Entra ID apps, SharePoint, Teams                     | Microsoft Learn docs (shared with Power Platform)               | Nothing                                                                    |
| `aws`            | AWS services, IAM, cost, CDK/CloudFormation                 | AWS Knowledge (`knowledge-mcp.global.api.aws`)                  | Nothing                                                                    |
| `gcp`            | Google Cloud services, IAM, cost, Terraform                 | Google Developer Knowledge                                      | `GOOGLE_DEVELOPER_KNOWLEDGE_API_KEY`                                       |
| `salesforce`     | Salesforce clouds, flows, Apex, LWC, Salesforce DX          | Salesforce DX MCP (`npx @salesforce/mcp`)                       | `sf` CLI with a default org                                                |
| `stripe`         | Payments, Billing, Connect, webhooks                        | Stripe (`mcp.stripe.com`)                                       | Sign in with `/mcp` in Claude Code                                         |
| `github`         | Repos, pull requests, Actions, rulesets                     | GitHub (`api.githubcopilot.com/mcp/`)                           | `GITHUB_PERSONAL_ACCESS_TOKEN` (fine-grained, limited to the team's repos) |

MCP servers are off unless you turn them on. Without one, a specialist still has web access and
its documentation links. Some servers (Azure, Dataverse, Salesforce, Stripe, GitHub) can change
real systems, so their prompts tell the agent to read first and only change things when the
task says so. Keep Claude Code's permission prompts on for them.

## Secrets and MCP servers

`team.json` never holds secret values:

- Local servers: `"env": { "NAME_THE_SERVER_READS": "env:YOUR_VARIABLE" }`
- Remote servers: `"headers": { "Authorization": "Bearer {env:YOUR_TOKEN}" }`

`agent-team apply` writes these as `${YOUR_VARIABLE}` in `.mcp.json`, and Claude Code fills them
in from your environment when it starts. `agent-team doctor` tells you which variables are missing
and whether each server's command is installed.

The first time you run `claude` in the project, it asks you to approve the project's MCP servers.
You can check them at any time with `/mcp`.

## Adding to the catalog

Add `catalog/specialists/<id>.md`:

```markdown
---
id: twilio
title: Twilio
description: "Shown to the PM: what it knows and when to use it (20+ characters)."
defaultModel: sonnet
tools: [Read, Grep, Glob, Write, Edit, WebFetch, WebSearch]
docs:
  - https://www.twilio.com/docs
mcp: # optional
  name: twilio
  server:
    command: npx
    args: ["-y", "some-twilio-mcp"]
    env:
      TWILIO_AUTH_TOKEN: env:TWILIO_AUTH_TOKEN
  requires: [TWILIO_AUTH_TOKEN]
  note: "Shown in the UI and by doctor."
---

### What to bring

The specialist's expertise: recommendations, pitfalls, limits.
```

The body is placed into the shared specialist template (`catalog/templates/specialist.md`). The
tests check every catalog file against the schema.
