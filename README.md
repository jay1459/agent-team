# agent-team

Run a software project with a team of Claude Code agents, led by a project manager agent.

You choose the team in a local web page: which roles are on (PM, architect, lead developer,
developers, presales, sales), which model each one uses, and which specialists to bring in
(Azure, Dynamics 365, AWS or any service you describe). `agent-team` turns that choice into files
Claude Code already understands. Then you run `claude` in your project and type `/team <goal>`.

## Quick start

Needs Node.js 22.12+ and [Claude Code](https://code.claude.com).

```sh
cd ~/my-project
npx @jay1459/agent-team ui          # set up the team in your browser
# or, in the terminal:
npx @jay1459/agent-team init --profile dev-team
npx @jay1459/agent-team apply

claude                              # then type: /team add a login page with email sign-in
```

`ui` prints a link such as `http://127.0.0.1:7420/#token=…`. The page has tabs for:

- **Team:** roles, models, how many developers or salespeople, tools, extra instructions
- **Specialists:** catalog services and your own, with optional MCP servers
- **Workflow:** approval gates, workspace, secrets, unattended runs
- **Profiles:** reusable teams
- **Preview & apply:** a diff of every file that will change
- **Runs:** logs of unattended runs
- **JSON:** the raw config

It checks the config as you type and won't save anything invalid.

To install it instead of using `npx`: `npm install -g @jay1459/agent-team`, then use `agent-team …`.

## How it works

```
 web UI ──writes──▶ team.json ──agent-team apply──▶ .claude/agents/*.md   ◀── claude
 (local)            (in your                        CLAUDE.md (PM section)     /team <goal>
                     project)                       .claude/commands/team.md
                                                    .mcp.json (specialists)
```

- The **PM is your Claude Code session.** It plans the work, keeps a brief, backlog and decision
  records in `team/`, hands tasks to the other agents, reviews what comes back, and stops at the
  approval gates you chose.
- **Every other role is a Claude Code subagent** with its own prompt, model and tools. Sales and
  presales can't run commands or edit code; developers can.
- Claude Code subagents can't start other subagents, so **hand-offs go through the PM**. For a
  real hierarchy, `agent-team run --layered` gives the lead developer their own team (see
  [Unattended runs](#unattended-runs)).

`apply` keeps your own text in `CLAUDE.md` and `.mcp.json` and never overwrites the team's files in
`team/`. When an agent leaves the team its file is removed, unless you edited it by hand, in which
case it's left in place with a warning.

## Roles

| Role      | Default model | What it does                                                | Tools                        |
| --------- | ------------- | ----------------------------------------------------------- | ---------------------------- |
| PM        | opus          | Plans, delegates, reviews, reports, stops at approval gates | Your Claude Code session     |
| Architect | opus          | Solution design, technology choices, decision records       | Read, write docs, web        |
| Lead dev  | sonnet        | Splits designs into tasks, project set-up, code review      | Read, edit, Bash             |
| Developer | sonnet        | Builds features and fixes; up to 10 in parallel             | Read, edit, Bash             |
| Presales  | sonnet        | Requirements, solution outlines, estimates, proposals       | Read, write docs, web        |
| Sales     | haiku         | Account research, email drafts, pitch material; up to 10    | Read, write docs, web search |

Models are aliases (`opus`, `sonnet`, `haiku`, `inherit`), so they follow the latest model in each
family. You can pin a full model ID such as `claude-sonnet-5-5` instead. Each role can also add
instructions or change its tools. The prompts live in [`catalog/roles/`](catalog/roles).

## Specialists

| Specialist     | MCP server (optional)                  |
| -------------- | -------------------------------------- |
| Azure          | Azure MCP Server                       |
| Dynamics 365   | Dataverse (Microsoft's official proxy) |
| Power Platform | Microsoft Learn docs                   |
| Microsoft 365  | Microsoft Learn docs                   |
| AWS            | AWS Knowledge                          |
| Google Cloud   | Google Developer Knowledge             |
| Salesforce     | Salesforce DX                          |
| Stripe         | Stripe (hosted; sign in with `/mcp`)   |
| GitHub         | GitHub (personal access token)         |
| _Your own_     | Any local command or remote URL        |

See [docs/specialists.md](docs/specialists.md) for what each one needs and how to add your own.

## Commands

| Command                                             | What it does                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| `agent-team ui [--host] [--port]`                   | Edit the team in your browser                                      |
| `agent-team init [--profile <name>]`                | Create `team.json`, from a profile if given                        |
| `agent-team validate`                               | Check `team.json`                                                  |
| `agent-team apply [--dry-run] [--diff]`             | Show what will change, ask, then write the files Claude Code reads |
| `agent-team doctor`                                 | Check Node, Claude Code, generated files, MCP servers and secrets  |
| `agent-team profile list \| show \| save \| delete` | Built-in profiles (`minimal`, `dev-team`, `consultancy`) and yours |
| `agent-team run "<goal>" [--budget <usd>]`          | Run the team unattended on the Claude Agent SDK                    |
| `agent-team run --continue "<reply>"`               | Answer the PM and carry on                                         |
| `agent-team runs`                                   | List runs and what they cost                                       |

Every command takes `-C <project folder>`. `--help` lists all the options.

## Configuration

Everything lives in `team.json` in your project. It's safe to commit because it never holds
secrets, only `env:VAR` references (the schema rejects anything else):

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/jay1459/agent-team/main/schemas/team.schema.json",
  "version": 1,
  "project": { "name": "Contoso field service" },
  "roles": {
    "pm": { "enabled": true, "model": "opus" },
    "architect": { "enabled": true },
    "lead-dev": { "enabled": true },
    "developer": { "enabled": true, "count": 3 },
  },
  "specialists": [{ "id": "azure", "enabled": true, "mcp": true }],
  "workflow": { "humanApproval": ["architecture", "merge"], "workspace": "team/" },
  "secrets": { "AZURE_SUBSCRIPTION_ID": "env:AZURE_SUBSCRIPTION_ID" },
}
```

The `$schema` line gives you completion and checking in VS Code and other editors. The full
reference is in [docs/configuration.md](docs/configuration.md), and there are examples in
[`examples/`](examples).

**Profiles** are reusable teams kept in `~/.agent-team/profiles/`. Start a project from one, tweak
its `team.json`, and save it as a new profile if you like.

## Unattended runs

`agent-team run` runs the same team without a chat, on the
[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk). It has budgets, a log of every step,
and an optional **layered** team in which the PM hands build work to the lead developer, who
directs the developers. Runs are billed. See [docs/runner.md](docs/runner.md).

```sh
npm install -g @jay1459/agent-team @anthropic-ai/claude-agent-sdk
agent-team run "Add a blog with posts and comments" --budget 5 --layered
```

## Security

- The UI listens on 127.0.0.1 by default. Every API call needs the random token in the link it
  prints, and pages are served with a strict Content-Security-Policy. If you open it to your
  network with `--host 0.0.0.0`, anyone with the link can change the project's agent files.
- `team.json` and profiles can't hold secret values. MCP servers get them from your environment.
- Specialists with MCP servers that can change real systems (Azure, Dataverse, Salesforce, Stripe,
  GitHub) are told to read first and change things only when their task says so. Keep Claude Code's
  permission prompts on.

To report a security problem, see [SECURITY.md](SECURITY.md).

## Development

```sh
npm install
npm run build     # schema → web UI → CLI (bundled with esbuild)
npm test          # unit tests; never call a paid API
npm run e2e       # drives the web UI in Chromium (first: npx playwright install chromium)
npm run lint
npm run dev:ui    # Vite dev server; run `agent-team ui --port 7420` alongside for the API
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [docs/architecture.md](docs/architecture.md) and
[docs/releasing.md](docs/releasing.md).

## Licence

[MIT](LICENSE)
