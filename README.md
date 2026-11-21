# agent-team

Run a software project with a team of Claude Code agents, led by a project manager agent.

You choose the team in a local web page: which roles are on (PM, architect, lead developer,
developers, presales, sales), which model each one uses, and which specialists to bring in
(Azure, Dynamics 365 or any service you describe). `agent-team` turns that choice into files
Claude Code already understands, so you then just run `claude` in your project and type
`/team <goal>`.

> **Status: early.** This first release has the config schema, the role catalog and examples.
> The CLI, generator and web UI follow; see the [roadmap](#roadmap).

## How it works

```
 web UI ──writes──▶ team.json ──agent-team apply──▶ .claude/agents/*.md   ◀── claude
 (local)            (in your                        CLAUDE.md (PM section)     /team <goal>
                     project)                       .claude/commands/team.md
                                                    .mcp.json (specialists)
```

- The **PM is your Claude Code session.** It plans the work, keeps a backlog in `team/` and hands
  tasks to the other agents.
- **Every other role is a Claude Code subagent** with its own prompt, model and tool permissions.
  Sales and presales can't run commands or edit code; developers can.
- Subagents can't start other subagents, so **all hand-offs go through the PM.** The lead
  developer writes tasks for the developers and the PM assigns them. See
  [docs/architecture.md](docs/architecture.md).

## Roles

| Role      | Default model | What it does                                                | Tools                        |
| --------- | ------------- | ----------------------------------------------------------- | ---------------------------- |
| PM        | opus          | Plans, delegates, reviews, reports, stops at approval gates | Main session                 |
| Architect | opus          | Solution design, technology choices, decision records       | Read, write docs, web        |
| Lead dev  | sonnet        | Splits designs into tasks, project setup, code review       | Read, edit, Bash             |
| Developer | sonnet        | Builds features and fixes; up to 10 in parallel             | Read, edit, Bash             |
| Presales  | sonnet        | Requirements, solution outlines, estimates, proposals       | Read, write docs, web        |
| Sales     | haiku         | Account research, email drafts, pitch material; up to 10    | Read, write docs, web search |

Prompts live in [`catalog/roles/`](catalog/roles). Each role can add its own instructions,
change its model or replace its tool list in `team.json`.

Models are aliases (`opus`, `sonnet`, `haiku`, `inherit`) so they follow the latest model in each
family. You can pin a full model ID such as `claude-sonnet-5-5` instead.

## team.json

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/jay1459/agent-team/main/schemas/team.schema.json",
  "version": 1,
  "extends": "consultancy", // the profile this was created from, if any
  "project": { "name": "Contoso field service" },
  "defaults": { "model": "sonnet" },
  "roles": {
    "pm": { "enabled": true, "model": "opus" },
    "architect": { "enabled": true, "model": "opus" },
    "developer": { "enabled": true, "count": 3 },
    "sales": { "enabled": false },
  },
  "specialists": [
    { "id": "azure", "enabled": true, "mcp": true },
    {
      "id": "custom:twilio",
      "enabled": true,
      "title": "Twilio",
      "description": "SMS and WhatsApp messaging via Twilio",
    },
  ],
  "workflow": { "humanApproval": ["architecture", "merge"], "workspace": "team/" },
  "secrets": { "AZURE_SUBSCRIPTION_ID": "env:AZURE_SUBSCRIPTION_ID" },
}
```

The `$schema` line gives you completion and checking in VS Code and other editors. Full
examples are in [`examples/`](examples).

**Profiles** are reusable teams kept in `~/.agent-team/profiles/`. Start a project from one, tweak
its `team.json`, and save it back as a new profile if you like.

**Secrets never go in the config.** It only holds `env:VAR_NAME` references, and the schema
rejects anything else, so `team.json` is safe to commit.

## Roadmap

1. ✅ Schema, role catalog, examples, tests
2. CLI and generator: `agent-team validate`, `agent-team apply`, `/team` command
3. Local web UI: team, specialists, workflow, profiles, preview, apply
4. Specialist catalog (Azure, Dynamics 365, AWS, …), custom specialists, MCP set-up, `agent-team doctor`
5. Optional Agent SDK runner: layered teams (lead developer directs developers), cost limits, run log
6. Docs and an npm release

## Development

Needs Node 22.12 or later.

```sh
npm install
npm test          # unit tests, no API calls
npm run lint      # ESLint + Prettier
npm run schemas   # regenerate schemas/*.schema.json after changing the schema
```

Tests never call a paid API. Any future end-to-end check that runs real agents will be a separate,
opt-in script.

## Licence

[MIT](LICENSE)
