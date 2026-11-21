// Copies the built web UI, the catalog, README and licence into the CLI package so `npm pack`
// ships everything it needs.
import { cpSync, existsSync, rmSync } from "node:fs";

const here = (p) => new URL(p, import.meta.url);
for (const [from, to] of [
  ["../../web/dist/", "../web/"],
  ["../../../catalog/", "../catalog/"],
  ["../../../README.md", "../README.md"],
  ["../../../LICENSE", "../LICENSE"],
]) {
  if (!existsSync(here(from))) {
    console.error(`copy-assets: ${here(from).pathname} is missing; build it first`);
    process.exit(1);
  }
  rmSync(here(to), { recursive: true, force: true });
  cpSync(here(from), here(to), { recursive: true });
}
