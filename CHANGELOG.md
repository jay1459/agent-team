# Changelog

## 0.1.0 (unreleased)

- `/team` from any folder: `agent-team install-command` adds a user-level `/team [project] <goal>`
  that starts a project's team with Remote Control (or runs it in place inside a project);
  `agent-team projects | start | session` do the same from the terminal
- Start tab: start the team in a Claude Code Remote Control session from the UI, with its
  claude.ai/code link, a button for the folder-trust question, permission mode and stop
- Roles for QA, UAT testers, security and legal; QA and UAT testers can have several agents
- "PM decides" for the number of agents in team roles
- The team works in its own git repository: the UI starts by creating, opening or cloning one
  (optionally creating it on GitHub), `init --new` / `--clone` do the same, and agent-team's own
  folder is refused

First release.

- `team.json` schema with roles, specialists, workflow, runner settings and env-only secrets;
  JSON Schema for editors
- Roles: PM, architect, lead developer, developers (1–10), presales, sales (1–10)
- Specialists: Azure, Dynamics 365, Power Platform, Microsoft 365, AWS, Google Cloud, Salesforce,
  Stripe, GitHub, plus your own, each with an optional MCP server
- `agent-team init | validate | apply | doctor | profile`: generates Claude Code subagents, a PM
  section in `CLAUDE.md`, a `/team` command and `.mcp.json` entries
- `agent-team ui`: local web UI with a token-protected API
- `agent-team run | runs`: unattended runs on the Claude Agent SDK with budgets, run logs and
  layered teams
