// A real, billed end-to-end run of `agent-team run` on a throwaway project. Never run automatically.
//
//   AGENT_TEAM_SMOKE=1 npm run smoke:run            # flat team
//   AGENT_TEAM_SMOKE=1 npm run smoke:run -- --layered
//
// Uses haiku for every agent and caps the run at $0.50 (each layered hand-off at $0.25).
// Needs Claude credentials: `claude` signed in, or ANTHROPIC_API_KEY.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.env.AGENT_TEAM_SMOKE !== "1") {
  console.error(
    "This makes real, billed Claude calls (up to about $0.50). Set AGENT_TEAM_SMOKE=1 to run it.",
  );
  process.exit(2);
}

const layered = process.argv.includes("--layered");
const cli = new URL("../packages/cli/dist/cli.js", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "agent-team-smoke-"));
writeFileSync(
  join(dir, "team.json"),
  JSON.stringify({
    version: 1,
    project: { name: "Smoke test", summary: "A throwaway project for checking agent-team run." },
    defaults: { model: "haiku" },
    roles: {
      pm: { enabled: true, model: "haiku" },
      "lead-dev": { enabled: layered },
      developer: { enabled: true },
    },
    workflow: { humanApproval: [], workspace: "team/" },
    runner: { layered, maxBudgetUsd: 0.5, teamBudgetUsd: 0.25, permissionMode: "acceptEdits" },
  }),
);

const goal =
  "Have a developer create hello.txt in the project root containing exactly the word hello. Don't do it yourself. Then finish.";
console.log(`Project: ${dir}\nMode: ${layered ? "layered" : "flat"}\n`);
const run = spawnSync(process.execPath, [cli, "run", "-C", dir, goal, "--yes"], {
  stdio: "inherit",
});

const file = join(dir, "hello.txt");
const ok = run.status === 0 && existsSync(file) && readFileSync(file, "utf8").trim() === "hello";
console.log(
  ok
    ? "\n✓ smoke run passed"
    : `\n✗ smoke run failed (exit ${run.status}, hello.txt ${existsSync(file) ? "wrong" : "missing"})`,
);
process.exit(ok ? 0 : 1);
