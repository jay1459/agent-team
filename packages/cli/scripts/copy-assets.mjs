// Copies the built web UI and the catalog into the CLI package so `npm pack` ships them.
import { cpSync, existsSync, rmSync } from "node:fs";

const here = (p) => new URL(p, import.meta.url);
for (const [from, to] of [
  ["../../web/dist/", "../web/"],
  ["../../../catalog/", "../catalog/"],
]) {
  if (!existsSync(here(from))) {
    console.error(`copy-assets: ${here(from).pathname} is missing; build it first`);
    process.exit(1);
  }
  rmSync(here(to), { recursive: true, force: true });
  cpSync(here(from), here(to), { recursive: true });
}
