import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generate } from "../src/generate.js";
import {
  applyPlan,
  mergeClaudeMd,
  pendingChanges,
  planApply,
  PlanError,
  SECTION_END,
  SECTION_START,
} from "../src/plan.js";
import { catalog, config, tempDir } from "./helpers.js";

const team = (extra: Parameters<typeof config>[0] = {}) =>
  config({
    roles: {
      pm: { enabled: true },
      architect: { enabled: true },
      developer: { enabled: true, count: 2 },
    },
    ...extra,
  });

function apply(dir: string, cfg = team()) {
  const plan = planApply(dir, generate(cfg, catalog));
  applyPlan(plan);
  return plan;
}

const read = (dir: string, path: string) => readFileSync(join(dir, path), "utf8");

describe("mergeClaudeMd", () => {
  it("creates, appends to, and updates CLAUDE.md, keeping the user's text", () => {
    const created = mergeClaudeMd(null, "v1");
    expect(created).toBe(`${SECTION_START}\nv1\n${SECTION_END}\n`);

    const appended = mergeClaudeMd("# Mine\n\nNotes\n", "v1");
    expect(appended).toBe(`# Mine\n\nNotes\n\n${SECTION_START}\nv1\n${SECTION_END}\n`);

    const updated = mergeClaudeMd(`${appended}\nAfter\n`, "v2");
    expect(updated).toBe(`# Mine\n\nNotes\n\n${SECTION_START}\nv2\n${SECTION_END}\n\nAfter\n`);
  });

  it("refuses broken markers", () => {
    expect(() => mergeClaudeMd(`${SECTION_START}\nno end`, "x")).toThrow(PlanError);
    expect(() => mergeClaudeMd(`${SECTION_END}\n${SECTION_START}`, "x")).toThrow(PlanError);
    expect(() =>
      mergeClaudeMd(`${SECTION_START}${SECTION_END}${SECTION_START}${SECTION_END}`, "x"),
    ).toThrow(PlanError);
  });
});

describe("planApply / applyPlan", () => {
  it("writes everything on first apply and nothing on the second", () => {
    const dir = tempDir();
    const first = apply(dir);
    expect(pendingChanges(first).map((c) => [c.kind, c.path])).toEqual([
      ["create", ".claude/agents/architect.md"],
      ["create", ".claude/agents/developer-1.md"],
      ["create", ".claude/agents/developer-2.md"],
      ["create", ".claude/commands/team.md"],
      ["create", "CLAUDE.md"],
      ["create", "team/brief.md"],
      ["create", "team/backlog.md"],
      ["create", "team/decisions/README.md"],
      ["create", ".claude/agent-team.json"],
    ]);
    expect(pendingChanges(planApply(dir, generate(team(), catalog)))).toEqual([]);
  });

  it("never overwrites the team's workspace files", () => {
    const dir = tempDir();
    apply(dir);
    writeFileSync(join(dir, "team/backlog.md"), "my tasks");
    apply(dir, team({ project: { name: "Renamed" } }));
    expect(read(dir, "team/backlog.md")).toBe("my tasks");
    expect(read(dir, ".claude/agents/architect.md")).toContain("for Renamed.");
  });

  it("removes agents that leave the team, unless they were edited by hand", () => {
    const dir = tempDir();
    apply(dir);
    writeFileSync(join(dir, ".claude/agents/developer-2.md"), "my own developer");

    const plan = apply(
      dir,
      team({ roles: { pm: { enabled: true }, developer: { enabled: true } } }),
    );
    expect(
      pendingChanges(plan)
        .filter((c) => c.kind === "delete")
        .map((c) => c.path),
    ).toEqual([".claude/agents/architect.md", ".claude/agents/developer-1.md"]);
    expect(plan.warnings).toEqual([
      ".claude/agents/developer-2.md is no longer generated but was edited by hand, so it was left in place.",
    ]);
    expect(existsSync(join(dir, ".claude/agents/architect.md"))).toBe(false);
    expect(existsSync(join(dir, ".claude/agents/developer.md"))).toBe(true);
    expect(read(dir, ".claude/agents/developer-2.md")).toBe("my own developer");
  });

  it("manages only its own servers in .mcp.json", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, ".mcp.json"),
      JSON.stringify({ mcpServers: { mine: { command: "mine" } } }),
    );
    const spec = (mcp: { command: string } | undefined) =>
      team({
        specialists: [
          {
            id: "custom:sms",
            enabled: true,
            title: "SMS",
            description: "SMS",
            ...(mcp ? { mcp } : {}),
          },
        ],
      });

    apply(dir, spec({ command: "sms-mcp" }));
    expect(JSON.parse(read(dir, ".mcp.json")).mcpServers).toEqual({
      mine: { command: "mine" },
      sms: { type: "stdio", command: "sms-mcp", args: [] },
    });

    apply(dir, spec(undefined));
    expect(JSON.parse(read(dir, ".mcp.json")).mcpServers).toEqual({ mine: { command: "mine" } });
  });

  it("doesn't create .mcp.json when no server is needed", () => {
    const dir = tempDir();
    apply(dir);
    expect(existsSync(join(dir, ".mcp.json"))).toBe(false);
  });

  it("reports unreadable files instead of overwriting them", () => {
    const dir = tempDir();
    writeFileSync(join(dir, ".mcp.json"), "{ not json");
    expect(() => planApply(dir, generate(team(), catalog))).toThrow(/\.mcp\.json isn't valid JSON/);

    const dir2 = tempDir();
    mkdirSync(join(dir2, ".claude"));
    writeFileSync(join(dir2, ".claude/agent-team.json"), "nope");
    expect(() => planApply(dir2, generate(team(), catalog))).toThrow(
      /agent-team\.json isn't valid JSON/,
    );
  });
});
