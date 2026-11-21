# Releasing

The npm package is `@jay1459/agent-team` (built from `packages/cli`). The schema package is
bundled into it, so nothing else is published.

1. Update `version` in `packages/cli/package.json` and add a section to `CHANGELOG.md`.
2. Check it builds, passes and packs:
   ```sh
   npm ci && npm run build && npm test && npm run e2e && npm run lint
   cd packages/cli && npm pack --dry-run
   ```
3. Merge to `main`, then tag: `git tag v0.1.0 && git push origin v0.1.0`.
4. Publish:
   - **By hand:** `npm login`, then `npm publish -w @jay1459/agent-team` (it's public; see
     `publishConfig`).
   - **From GitHub Actions** (recommended, adds provenance): add an `NPM_TOKEN` repository secret
     (an npm automation token) and the release workflow below. Pushing a `v*` tag then publishes.

```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    tags: ["v*"]
permissions:
  contents: read
  id-token: write # npm provenance
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          registry-url: https://registry.npmjs.org
      - run: npm ci
      - run: npm run build
      - run: npm test
      - run: npm publish -w @jay1459/agent-team
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Before a release, it's worth running the paid smoke test once: `AGENT_TEAM_SMOKE=1 npm run
smoke:run`, which costs about $0.50 at most.
