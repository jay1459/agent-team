# Contributing

Thanks for helping. Issues and pull requests are welcome.

## Set-up

```sh
npm install
npm run build
npm test
npx playwright install chromium && npm run e2e
```

## Layout

- `packages/schema`: the `team.json` schema (Zod), the single source of truth. After changing
  it, run `npm run schemas` to regenerate `schemas/*.schema.json`. A test fails if you forget.
- `packages/cli`: the generator, `apply` planner, UI server, doctor and runner.
- `packages/web`: the React UI.
- `catalog/`: role and specialist prompts, templates and built-in profiles. Tests check every file.

## Guidelines

- Keep prompts plain and specific. Say what the agent should do, not what it is.
- New specialist? Add `catalog/specialists/<id>.md` (see [docs/specialists.md](docs/specialists.md)).
  Take the MCP set-up from the vendor's own docs, and say in the PR where you checked it.
- Tests must never call a paid API. Use the fake SDK in `packages/cli/test/fake-sdk.ts`. Real
  runs belong in opt-in scripts like `scripts/smoke-run.mjs`.
- Run `npm run lint` and `npm run typecheck` before opening a PR.
