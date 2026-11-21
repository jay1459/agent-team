// Bundles the CLI into dist/cli.js with the (unpublished) schema package inlined, so the npm
// package only depends on published packages. The Agent SDK stays external: it's an optional peer
// loaded with a dynamic import when `agent-team run` starts.
import { chmodSync, readFileSync } from "node:fs";
import { build } from "esbuild";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const external = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
].filter((name) => name !== "@agent-team/schema");

const out = new URL("../dist/cli.js", import.meta.url).pathname;
await build({
  entryPoints: [new URL("../src/cli.ts", import.meta.url).pathname],
  outfile: out,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external,
  sourcemap: true,
  legalComments: "none",
  logLevel: "warning",
});
chmodSync(out, 0o755);
