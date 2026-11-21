import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { doctorDeps, main } from "../src/cli.js";
import { formatChecks, runDoctor, type DoctorDeps } from "../src/doctor.js";
import { generate } from "../src/generate.js";
import { applyPlan, planApply } from "../src/plan.js";
import { catalog, config, fakeIo, tempDir } from "./helpers.js";

const deps = (over: Partial<DoctorDeps> = {}): DoctorDeps => ({
  env: {},
  nodeVersion: "22.20.0",
  which: (cmd) => `/usr/bin/${cmd}`,
  claudeVersion: () => "2.1.302 (Claude Code)",
  ...over,
});

function project(input: Parameters<typeof config>[0] = {}, applied = true) {
  const dir = tempDir();
  const cfg = config(input);
  writeFileSync(join(dir, "team.json"), JSON.stringify(cfg));
  if (applied) applyPlan(planApply(dir, generate(cfg, catalog)));
  return dir;
}

const run = (dir: string, d: DoctorDeps) => runDoctor(dir, join(dir, "team.json"), catalog, d);
const levels = (checks: ReturnType<typeof run>) =>
  Object.fromEntries(checks.map((c) => [c.title, c.level]));

describe("doctor", () => {
  it("passes a fresh, applied project", () => {
    const checks = run(project(), deps());
    expect(levels(checks)).toEqual({
      "Node.js 22.20.0": "ok",
      "Claude Code 2.1.302": "ok",
      "team.json is valid: PM + 0 agents": "ok",
      "Generated files are up to date": "ok",
    });
  });

  it("flags old Node, missing Claude Code, and files that need applying", () => {
    const checks = run(
      project({}, false),
      deps({ nodeVersion: "20.11.0", claudeVersion: () => null }),
    );
    expect(levels(checks)).toMatchObject({
      "Node.js 20.11.0": "error",
      "Claude Code not found": "warn",
    });
    expect(checks.find((c) => c.title.includes("out of date"))).toMatchObject({ level: "warn" });
  });

  it("stops early when team.json is missing or invalid", () => {
    const missing = run(tempDir(), deps());
    expect(missing.at(-1)).toMatchObject({ level: "error", title: "No team.json" });

    const dir = tempDir();
    writeFileSync(
      join(dir, "team.json"),
      JSON.stringify({ version: 1, project: { name: "x" }, roles: {} }),
    );
    expect(run(dir, deps()).at(-1)).toMatchObject({
      level: "error",
      title: "team.json has problems",
    });
  });

  it("checks MCP commands and the variables they need", () => {
    const dir = project({
      specialists: [
        { id: "dynamics365", enabled: true, mcp: true },
        { id: "github", enabled: true, mcp: true },
        { id: "power-platform", enabled: true, mcp: true },
        { id: "microsoft-365", enabled: true, mcp: true },
      ],
    });
    const checks = run(
      dir,
      deps({ which: () => null, env: { GITHUB_PERSONAL_ACCESS_TOKEN: "x" } }),
    );
    const byTitle = Object.fromEntries(checks.map((c) => [c.title, c]));

    expect(byTitle['MCP server "dataverse"']).toMatchObject({ level: "error" });
    expect(byTitle['MCP server "dataverse"']!.detail).toContain("`npx` isn't on PATH.");
    expect(byTitle['MCP server "dataverse"']!.detail).toContain(
      "Set DATAVERSE_URL before starting claude.",
    );
    expect(byTitle['MCP server "github"']).toMatchObject({ level: "ok" });
    expect(checks.filter((c) => c.title === 'MCP server "microsoft-learn"')).toHaveLength(1);
    expect(byTitle["Approve the MCP servers in Claude Code"]).toMatchObject({ level: "info" });
  });

  it("checks that secrets are set", () => {
    const dir = project({ secrets: { A: "env:A_VAR", B: "env:B_VAR" } });
    expect(run(dir, deps({ env: { A_VAR: "1" } })).at(-1)).toMatchObject({
      level: "warn",
      detail: "B: B_VAR isn't set",
    });
    expect(run(dir, deps({ env: { A_VAR: "1", B_VAR: "2" } })).at(-1)).toMatchObject({
      level: "ok",
    });
  });

  it("formats checks with icons and indented details", () => {
    expect(
      formatChecks([
        { level: "ok", title: "Fine" },
        { level: "error", title: "Bad", detail: "a\nb" },
      ]),
    ).toBe("✓ Fine\n✗ Bad\n    a\n    b");
  });

  it("exits 1 only when there are errors", async () => {
    const original = doctorDeps.get;
    try {
      const dir = project();
      doctorDeps.get = () => deps();
      const ok = fakeIo(dir);
      expect(await main(["doctor"], ok.io, catalog)).toBe(0);
      expect(ok.text()).toContain("Ready. Run `claude` here");

      doctorDeps.get = () => deps({ nodeVersion: "18.0.0" });
      const bad = fakeIo(dir);
      expect(await main(["doctor"], bad.io, catalog)).toBe(1);
      expect(bad.text()).toContain("1 problem(s) to fix.");
    } finally {
      doctorDeps.get = original;
    }
  });
});
