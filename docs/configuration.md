# team.json reference

`team.json` sits in your project's root. The UI writes it, but you can also edit it by hand. Add
the `$schema` line and your editor will check it and offer completion. Run `agent-team validate`
to check it from the terminal.

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/jay1459/agent-team/main/schemas/team.schema.json",
  "version": 1,
  "extends": "consultancy",
  "project": { "name": "…", "summary": "…" },
  "defaults": { "model": "sonnet" },
  "roles": { … },
  "specialists": [ … ],
  "workflow": { … },
  "runner": { … },
  "secrets": { … }
}
```

| Key           | Required | Meaning                                                                                                         |
| ------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `version`     | yes      | Always `1`                                                                                                      |
| `extends`     | no       | The profile this config was created from. For information only: later changes to the profile don't flow through |
| `project`     | yes      | `name` (used in every prompt) and an optional `summary` (the start of the brief)                                |
| `defaults`    | no       | `model`: overrides the catalog's default model for every agent that doesn't set its own                         |
| `roles`       | yes      | See below. `pm` must be enabled                                                                                 |
| `specialists` | no       | See below                                                                                                       |
| `workflow`    | no       | Approval gates and the shared workspace folder                                                                  |
| `runner`      | no       | Settings for `agent-team run`                                                                                   |
| `secrets`     | no       | Names agents may need, mapped to environment variables                                                          |

Unknown keys are rejected, so a typo can't be silently ignored.

## Models

Any of `opus`, `sonnet`, `haiku` or `inherit` (use the session's model), or a full model ID that
starts with `claude-`, such as `claude-sonnet-5-5`. An agent's model is resolved in this order:
its own `model`, then `defaults.model`, then the catalog's default for that role.

The PM's model is set on the `/team` command, so it applies when you start work with `/team`.

## roles

Keys: `pm`, `architect`, `lead-dev`, `developer`, `qa`, `uat-tester`, `security`, `legal`,
`presales`, `sales`.

| Field          | Meaning                                                                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`      | Whether the role is on the team                                                                                                                                                  |
| `model`        | See [Models](#models)                                                                                                                                                            |
| `count`        | `developer`, `qa`, `uat-tester` and `sales` only: 1–10 agents (named `developer-1`, `developer-2`, …), or `"pm-decides"` for one agent the PM runs as many copies of as it needs |
| `promptAppend` | Extra instructions added to the end of the role's prompt                                                                                                                         |
| `tools`        | Replaces the role's tool list (Claude Code tool names, or `mcp__server`)                                                                                                         |

## specialists

A list of entries. Use a catalog `id` (`azure`, `dynamics365`, `power-platform`, `microsoft-365`,
`aws`, `gcp`, `salesforce`, `stripe`, `github`) or `custom:<slug>` for your own.

| Field                            | Meaning                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| `enabled`                        | Whether it's on the team                                                               |
| `model`, `promptAppend`, `tools` | As for roles                                                                           |
| `mcp`                            | Catalog: `true` connects the catalog's MCP server. Custom: a server definition (below) |
| `title`, `description`           | Custom only, required: its name, and what it knows (the PM reads this)                 |
| `docs`                           | Custom only: documentation URLs the specialist checks first                            |

A custom MCP server is either a local command or a remote URL:

```jsonc
{ "command": "npx", "args": ["-y", "some-mcp-server"], "env": { "API_KEY": "env:MY_API_KEY" } }
{ "type": "http", "url": "https://mcp.example.com", "headers": { "Authorization": "Bearer {env:MY_TOKEN}" } }
```

`env` values must be `env:VAR`, and header values must be `{env:VAR}`, optionally after a word such
as `Bearer`. They become `${VAR}` in `.mcp.json`, which Claude Code fills in from your environment.

## workflow

| Field           | Default                     | Meaning                                                                                                             |
| --------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `humanApproval` | `["architecture", "merge"]` | Where the PM stops and asks: `requirements`, `architecture`, `estimate`, `customer-facing-docs`, `merge`, `release` |
| `workspace`     | `"team/"`                   | Folder for the brief, backlog, decisions, drafts and run logs. Must be inside the project                           |

## runner

Used by `agent-team run` only. See [runner.md](runner.md).

| Field            | Default         | Meaning                                                            |
| ---------------- | --------------- | ------------------------------------------------------------------ |
| `layered`        | `false`         | The lead developer directs the developers. Needs both roles on     |
| `maxBudgetUsd`   | none            | Stop the PM's session after this much spend                        |
| `teamBudgetUsd`  | none            | Cap for each hand-off to the lead developer's team                 |
| `permissionMode` | `"acceptEdits"` | `acceptEdits`, `default` (ask before edits) or `plan` (no changes) |

## secrets

```jsonc
"secrets": { "AZURE_SUBSCRIPTION_ID": "env:AZURE_SUBSCRIPTION_ID" }
```

Each value must be an `env:VAR` reference. `agent-team doctor` warns about any that aren't set.

## Profiles

A profile is the same file without `project`, `secrets` and `extends`, plus a `name` and an
optional `description`. Built-in profiles live in [`catalog/profiles/`](../catalog/profiles). Your
own are saved to `~/.agent-team/profiles/` (or `$AGENT_TEAM_HOME/profiles/`).
