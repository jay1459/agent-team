# Unattended runs (`agent-team run`)

Normally you run the team inside Claude Code: `claude`, then `/team <goal>`. `agent-team run` runs
the same team without a chat, using the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk).
It's useful for longer jobs, scripts, or a layered team.

> **Runs are billed.** They use your Claude sign-in or `ANTHROPIC_API_KEY`. Set a budget.

## Set-up

The SDK is an optional add-on (it bundles its own copy of Claude Code):

```sh
npm install -g @jay1459/agent-team @anthropic-ai/claude-agent-sdk
# or, without installing:
npx -p @jay1459/agent-team -p @anthropic-ai/claude-agent-sdk agent-team run "<goal>"
```

## Running

```sh
agent-team run "Add a blog with posts and comments" --budget 5
agent-team run --continue "Approved, go ahead"     # answer the PM and carry on
agent-team runs                                     # what ran and what it cost
```

| Option                 | Does                                                                             |
| ---------------------- | -------------------------------------------------------------------------------- |
| `--budget <usd>`       | Stop once the PM's session has spent this much (overrides `runner.maxBudgetUsd`) |
| `--layered` / `--flat` | Override `runner.layered` for this run                                           |
| `--yes`                | Allow every tool call without asking                                             |
| `--continue`           | Continue the latest run's session with a new message                             |
| `--resume <session>`   | Continue a specific session                                                      |

Without `--yes`, anything the permission mode doesn't already allow is asked about in the terminal.
When there's no terminal it is refused, and the refusal is logged.

The run prints what each agent does as it happens, and writes every step to
`team/runs/<time>.jsonl`. The web UI's **Runs** tab shows the same logs.

## What the agents see

The runner doesn't depend on the files `agent-team apply` writes. It builds the team straight from
`team.json`, so it never runs a stale team:

- The PM gets the Claude Code system prompt, plus the PM section `apply` would put in `CLAUDE.md`,
  a note that it's running unattended, and the rest of your project's `CLAUDE.md`.
- Every other agent is passed to the SDK with its prompt, tools and model.
- MCP servers for specialists are passed directly, with `env:`/`{env:}` references filled in from
  your environment. The run won't start if one is missing.
- Your user and project Claude Code settings aren't loaded (`settingSources: []`), so runs behave
  the same on every machine. Permissions come from `runner.permissionMode` and the prompts above.

At an approval gate, the PM stops and asks. Reply with `agent-team run --continue "<answer>"`.

## Layered teams

Claude Code subagents can't start subagents, so in a normal team everything goes through the PM.
With `runner.layered` (or `--layered`), the lead developer gets a team of their own:

```
PM ──delegate_to_lead_dev──▶ lead developer (own session) ──Agent──▶ developer-1 … developer-n
 └──Agent──▶ architect, presales, sales, specialists
```

- The PM has a `delegate_to_lead_dev` tool instead of the developer subagents.
- Each call starts a separate session for the lead developer, whose subagents are the developers.
  The lead developer plans the work, hands it out, reviews it and reports back.
- `runner.teamBudgetUsd` caps each hand-off. The hand-offs together also stop at the run's budget.
- The cost summary shows the PM's spend and the team's spend separately.

## Config

```jsonc
"runner": {
  "layered": true,
  "maxBudgetUsd": 10,
  "teamBudgetUsd": 3,
  "permissionMode": "acceptEdits" // or "default" (ask before edits) or "plan" (no changes)
}
```

`bypassPermissions` can't be set in config. Use `--yes` for a single run when you mean it.

## Testing

`npm test` drives the runner with a fake SDK, so it costs nothing. A real run is a separate script
that refuses to start without a flag:

```sh
AGENT_TEAM_SMOKE=1 npm run smoke:run                # about $0.50 at most, haiku throughout
AGENT_TEAM_SMOKE=1 npm run smoke:run -- --layered
```
