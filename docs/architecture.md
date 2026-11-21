# Architecture

## Pieces

| Package               | Status  | Job                                                                          |
| --------------------- | ------- | ---------------------------------------------------------------------------- |
| `packages/schema`     | done    | Zod schema for `team.json`, profiles and catalog entries; JSON Schema export |
| `packages/cli`        | done    | `agent-team ui`, `validate`, `apply`, `init`, `profile`, `doctor`            |
| `packages/web`        | done    | Vite + React UI served by `agent-team ui`                                    |
| `packages/runner`     | phase 5 | Optional Agent SDK orchestrator                                              |
| `catalog/roles`       | done    | One markdown file per role: frontmatter (model, tools) + prompt              |
| `catalog/specialists` | phase 4 | Same format plus docs links and an optional MCP server                       |

The schema package is the single source of truth. The UI uses it for live checking, the CLI uses
it before generating anything, and `schemas/*.schema.json` is exported from it for editors. A test
fails if the exported files are out of date.

## Where config lives

- `team.json` sits in each project and is committed. It holds no secrets.
- Profiles sit in `~/.agent-team/profiles/<name>.json`. `agent-team init --profile <name>` copies one
  into a project and records it in `extends`. `agent-team profile save <name>` saves a project's
  team as a profile. A copied config doesn't change when its profile changes. The UI will show the
  differences and offer to update.

## Running on Claude Code

`agent-team apply` writes:

| File                       | Contents                                                              |
| -------------------------- | --------------------------------------------------------------------- |
| `.claude/agents/<id>.md`   | One subagent per enabled role or specialist: `model`, `tools`, prompt |
| `CLAUDE.md`                | A section between markers with the PM prompt, team list and gates     |
| `.claude/commands/team.md` | `/team <goal>`: starts the PM loop                                    |
| `.mcp.json`                | MCP servers for specialists that use one                              |
| `team/`                    | Shared workspace: brief, backlog, decisions, proposals, sales drafts  |

Team roles with `count > 1` become numbered subagents (`developer-1`, `developer-2`, …) so the PM
can run them in parallel on separate tasks.

The generator only touches its own files and the marked section of `CLAUDE.md`, and it shows a
diff before writing.

### The flat-team constraint

Claude Code subagents can't start other subagents. So:

- The PM must be the main session; it is the only agent that delegates.
- The lead developer can't direct developers. It writes tasks into `team/backlog.md`, and the PM
  assigns them.
- Every agent starts each task with no memory, so the PM passes the context it needs, and agents
  record their output in `team/`.

Phase 5 adds an optional runner on the Claude Agent SDK, driven by the same `team.json`, for teams
that need real layers, per-role cost limits or unattended runs.

## Web UI

`agent-team ui` starts a small `node:http` server that serves the built React app and a JSON API:

| Endpoint                         | Does                                                   |
| -------------------------------- | ------------------------------------------------------ |
| `GET /api/state`                 | Project folder, current `team.json`, catalog, profiles |
| `PUT /api/config`                | Validate and save `team.json`                          |
| `POST /api/preview`              | Generate and return the plan with a diff per file      |
| `POST /api/apply`                | Save `team.json` and write the files                   |
| `GET/POST/DELETE /api/profiles…` | List, load, save and delete profiles                   |

Security:

- It binds to `127.0.0.1` by default.
- A random token is printed in the link's `#fragment`, so it isn't sent in requests or logged. The
  page keeps it in `sessionStorage` and sends it as a bearer token. Cross-site pages can't add that
  header without a CORS preflight, which the server never approves.
- Pages are served with a strict Content-Security-Policy (no inline scripts, no eval). Zod runs in
  `jitless` mode in the browser for that reason.
- Request bodies are capped at 1 MB, and only valid configs are ever written.

The browser validates with the same schema package as the server, so errors show on the right tab
as you type.

## Templates

`catalog/templates/` holds the CLAUDE.md section, the `/team` command and the shared specialist
prompt. `catalog/profiles/` holds the built-in profiles.

## Prompt placeholders

Catalog prompts may use `{{project}}`, `{{workspace}}` and `{{approvalGates}}`, filled in by the
generator. A test rejects any other placeholder.
