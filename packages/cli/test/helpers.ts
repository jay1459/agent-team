import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTeamConfig, type TeamConfig, type TeamConfigInput } from "@agent-team/schema";
import { loadCatalog } from "../src/catalog.js";
import type { Io } from "../src/cli.js";

export const repoRoot = join(import.meta.dirname, "../../..");
export const catalog = loadCatalog(join(repoRoot, "catalog"));

export function tempDir(prefix = "agent-team-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function config(input: Partial<TeamConfigInput> = {}): TeamConfig {
  const result = parseTeamConfig({
    version: 1,
    project: { name: "Test project" },
    roles: { pm: { enabled: true } },
    ...input,
  });
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.value;
}

export function exampleConfig(name: string): TeamConfig {
  const raw: unknown = JSON.parse(
    readFileSync(join(repoRoot, "examples", name, "team.json"), "utf8"),
  );
  const result = parseTeamConfig(raw);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.value;
}

export function fakeIo(cwd: string, answers: boolean[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    confirm: async () => answers.shift() ?? false,
    cwd,
    isTTY: true,
  };
  return { io, out, err, text: () => out.join("\n"), errors: () => err.join("\n") };
}
