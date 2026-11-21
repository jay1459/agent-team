# agent-team

Run a software project with a team of Claude Code agents, led by a project manager agent.

You choose the team in a local web page: which roles are on (PM, architect, lead developer,
developers, presales, sales), which model each one uses, and which specialists to bring in
(Azure, Dynamics 365 or any service you describe). `agent-team` turns that choice into files
Claude Code already understands, so you then just run `claude` in your project and type
`/team <goal>`.

> **Status: early.** The schema, role catalog, command-line tool and web UI work. Specialists for
> Azure, Dynamics 365 and others follow; see the [roadmap](#roadmap).

## Quick start

From a clone of this repo (an npm release comes later):

```sh
npm install && npm run build
cd ~/my-project
node ~/agent-team/packages/cli/dist/cli.js init --profile dev-team   # writes team.json
node ~/agent-team/packages/cli/dist/cli.js apply                     # shows the plan, asks, writes
claude                                                               # then: /team add a login page
```

Or set the team up in your browser:

```sh
node ~/agent-team/packages/cli/dist/cli.js ui -C ~/my-project
# agent-team UI for /home/you/my-project
#   Open: http://127.0.0.1:7420/#token=…
```

The UI has tabs for the team (roles, models, counts, tools, extra instructions), specialists,
workflow (approval gates, workspace, secrets), profiles, a preview of every file that will change,
and the raw JSON. It checks the config as you type and won't save or apply anything invalid.

The UI only listens on 127.0.0.1 unless you pass `--host`. Every API call needs the token in the
link it prints, so other pages in your browser can't use it. If you open it to your network
(`--host 0.0.0.0`), anyone with the link can change the project's agent files.

| Command                                    | What it does                                                       |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `agent-team init [--profile <name>]`       | Create `team.json`, from a profile if given                        |
| `agent-team validate`                      | Check `team.json`                                                  |
| `agent-team apply [--dry-run] [--diff]`    | Show what will change, ask, then write the files Claude Code reads |
| `agent-team profile list`                  | Built-in profiles (`minimal`, `dev-team`, `consultancy`) and yours |
| `agent-team profile save <name>`           | Save this project's team as a profile                              |
| `agent-team profile show \| delete <name>` | Look at or remove a saved profile                                  |

`apply` keeps your own text in `CLAUDE.md` and `.mcp.json`. It never overwrites the team's
working files in `team/`. When an agent leaves the team, its file is removed, unless you've edited
it by hand, in which case it's left in place with a warning.

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
2. ✅ CLI and generator: `init`, `validate`, `apply`, `profile`, `/team` command
3. ✅ Local web UI: team, specialists, workflow, profiles, preview, apply
4. Specialist catalog (Azure, Dynamics 365, AWS, …), custom specialists, MCP set-up, `agent-team doctor`
5. Optional Agent SDK runner: layered teams (lead developer directs developers), cost limits, run log
6. Docs and an npm release

## Development

Needs Node 22.12 or later.

```sh
npm install
npm test          # unit tests, no API calls
npm run e2e       # builds, then drives the web UI in Chromium (npx playwright install chromium first)
npm run dev:ui    # Vite dev server; run `agent-team ui --port 7420` alongside for the API
npm run lint      # ESLint + Prettier
npm run schemas   # regenerate schemas/*.schema.json after changing the schema
```

Tests never call a paid API. Any future end-to-end check that runs real agents will be a separate,
opt-in script.

## Licence

[MIT](LICENSE)
