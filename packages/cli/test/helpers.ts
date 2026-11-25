import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTeamConfig, type TeamConfig, type TeamConfigInput } from "@agent-team/schema";
import { loadCatalog } from "../src/catalog.js";
import type { Io } from "../src/cli.js";
import type { SessionDeps } from "../src/rc-session.js";

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

const TRUST =
  " Quick safety check: Is this a project you created or one you trust?\n ❯ No, exit\n   Yes, I trust this folder\n";
const ACTIVE =
  " /remote-control is active · Continue here, on your phone, or at https://claude.ai/code/session_ABC123\n❯ \n";

/** A fake tmux that keeps sessions in memory. */
export function fakeTmux(installed = ["tmux", "claude"]) {
  const sessions = new Map<string, string>();
  const calls: string[][] = [];
  const deps: SessionDeps = {
    which: (c) => (installed.includes(c) ? `/usr/bin/${c}` : null),
    exec: (command, args) => {
      calls.push([command, ...args]);
      const target = (args[args.indexOf("-t") + 1] ?? "").replace(/^=/, "").replace(/:$/, "");
      const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });
      switch (args[0]) {
        case "has-session":
          return sessions.has(target) ? ok() : { status: 1, stdout: "", stderr: "no session" };
        case "new-session":
          sessions.set(args[args.indexOf("-s") + 1]!, TRUST);
          return ok();
        case "capture-pane":
          return ok(sessions.get(target) ?? "");
        case "send-keys":
          if (args.at(-1) === "Enter") sessions.set(target, ACTIVE);
          return ok();
        case "kill-session":
          sessions.delete(target);
          return ok();
        default:
          return { status: 1, stdout: "", stderr: "unknown" };
      }
    },
  };
  return { deps, calls, sessions };
}
