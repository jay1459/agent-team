import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sdkMcpServers, MissingEnvError } from "../src/run/mcp-config.js";
import { listRuns, readRun, type RunEvent } from "../src/run/run-log.js";
import {
  DELEGATE_TOOL,
  RunError,
  runTeam,
  summariseInput,
  type RunInput,
} from "../src/run/runner.js";
import { generate } from "../src/generate.js";
import { fakeSdk, msg } from "./fake-sdk.js";
import { catalog, config, tempDir } from "./helpers.js";

const team = (over: Parameters<typeof config>[0] = {}) =>
  config({
    roles: {
      pm: { enabled: true },
      architect: { enabled: true },
      "lead-dev": { enabled: true, model: "sonnet" },
      developer: { enabled: true, count: 2 },
    },
    ...over,
  });

function input(dir: string, sdk: RunInput["sdk"], over: Partial<RunInput> = {}): RunInput {
  return {
    projectDir: dir,
    config: team(),
    catalog,
    goal: "Add a login page",
    env: {},
    ask: async () => false,
    sdk,
    now: () => new Date("2026-11-21T10:00:00.000Z"),
    ...over,
  };
}

const kinds = (events: RunEvent[]) => events.map((e) => e.kind);

describe("runTeam (flat)", () => {
  it("runs the PM with the team as subagents and logs everything", async () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "CLAUDE.md"),
      "# House rules\n\nUse pnpm.\n\n<!-- agent-team:start -->\nold section\n<!-- agent-team:end -->\n",
    );
    const { sdk, calls } = fakeSdk(() => [
      msg.init(),
      msg.text("Planning the work."),
      msg.tool("t1", "Agent", { subagent_type: "developer-1", description: "Build the form" }),
      msg.tool("t2", "Bash", { command: "npm test" }, "t1"),
      msg.text("Form built, tests pass.", "t1"),
      msg.result(),
    ]);
    const outcome = await runTeam(input(dir, sdk, { maxBudgetUsd: 3 }));

    expect(outcome.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const { prompt, options } = calls[0]!;
    expect(prompt).toBe("Add a login page");
    expect(Object.keys(options.agents!)).toEqual([
      "architect",
      "developer-1",
      "developer-2",
      "lead-dev",
    ]);
    expect(options.agents!["lead-dev"]).toMatchObject({
      model: "sonnet",
      tools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash"],
    });
    expect(options.agents!.architect!.prompt).toContain("You are the solution architect");
    expect(options).toMatchObject({
      cwd: dir,
      model: "opus",
      settingSources: [],
      permissionMode: "acceptEdits",
      maxBudgetUsd: 3,
    });
    const append = (options.systemPrompt as { append: string }).append;
    expect(append).toContain("You are the project manager for Test project");
    expect(append).toContain("## Running unattended");
    expect(append).toContain("Use pnpm.");
    expect(append).not.toContain("old section");
    expect(options.resume).toBeUndefined();

    const events = readRun(join(dir, "team"), outcome.log.id)!;
    expect(kinds(events)).toEqual(["start", "session", "text", "tool", "tool", "text", "result"]);
    expect(events[3]).toMatchObject({
      agent: "pm",
      tool: "Agent",
      summary: "developer-1: Build the form",
    });
    expect(events[4]).toMatchObject({ agent: "developer-1", tool: "Bash", summary: "npm test" });
    expect(events[5]).toMatchObject({ agent: "developer-1", text: "Form built, tests pass." });
    expect(events.at(-1)).toMatchObject({
      ok: true,
      costUsd: 0.25,
      teamCostUsd: 0,
      turns: 4,
      sessionId: "sess-1",
    });
  });

  it("asks before tools that need permission, and logs refusals", async () => {
    const dir = tempDir();
    let decision: unknown;
    const { sdk } = fakeSdk(async function* (call) {
      decision = await call.options.canUseTool!("Bash", { command: "rm -rf build" }, {
        signal: new AbortController().signal,
      } as never);
      yield msg.result();
    });
    const asked: string[] = [];
    const outcome = await runTeam(input(dir, sdk, { ask: async (q) => (asked.push(q), false) }));
    expect(asked).toEqual(["pm wants to use Bash: rm -rf build"]);
    expect(decision).toMatchObject({ behavior: "deny" });
    expect(
      readRun(join(dir, "team"), outcome.log.id)!.find((e) => e.kind === "denied"),
    ).toMatchObject({ tool: "Bash" });

    await runTeam(input(dir, sdk, { ask: async () => true }));
    expect(decision).toMatchObject({ behavior: "allow" });
    await runTeam(
      input(dir, sdk, {
        approveAll: true,
        ask: async () => {
          throw new Error("shouldn't ask");
        },
      }),
    );
    expect(decision).toMatchObject({ behavior: "allow" });
  });

  it("passes resume and the config's budget and permission mode", async () => {
    const { sdk, calls } = fakeSdk(() => [msg.result()]);
    await runTeam(
      input(tempDir(), sdk, {
        resume: "sess-9",
        config: team({ runner: { maxBudgetUsd: 5, permissionMode: "default" } }),
      }),
    );
    expect(calls[0]!.options).toMatchObject({
      resume: "sess-9",
      maxBudgetUsd: 5,
      permissionMode: "default",
    });
  });

  it("reports budget stops and crashes as failures", async () => {
    const budget = fakeSdk(() => [
      msg.result({ subtype: "error_max_budget_usd", is_error: true, errors: ["Budget reached"] }),
    ]);
    const stopped = await runTeam(input(tempDir(), budget.sdk));
    expect(stopped.ok).toBe(false);
    expect(stopped.result).toMatchObject({
      subtype: "error_max_budget_usd",
      text: "Budget reached",
    });

    const crash = fakeSdk(async function* () {
      yield msg.init();
      throw new Error("Claude Code exited");
    });
    const failed = await runTeam(input(tempDir(), crash.sdk));
    expect(failed.ok).toBe(false);
    expect(
      readRun(failed.log.file.replace(/\/runs\/.*$/, ""), failed.log.id)!.at(-1),
    ).toMatchObject({
      kind: "error",
      message: "Claude Code exited",
    });
  });

  it("fills MCP environment references and refuses to start when they're missing", async () => {
    const cfg = team({ specialists: [{ id: "github", enabled: true, mcp: true }] });
    const { sdk, calls } = fakeSdk(() => [msg.result()]);
    await expect(runTeam(input(tempDir(), sdk, { config: cfg }))).rejects.toThrow(MissingEnvError);
    expect(calls).toHaveLength(0);

    await runTeam(
      input(tempDir(), sdk, { config: cfg, env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_x" } }),
    );
    expect(calls[0]!.options.mcpServers).toEqual({
      github: {
        type: "http",
        url: "https://api.githubcopilot.com/mcp/",
        headers: { Authorization: "Bearer ghp_x" },
      },
    });
  });
});

describe("runTeam (layered)", () => {
  it("lets the PM hand build work to the lead developer's own team", async () => {
    const dir = tempDir();
    const { sdk, calls } = fakeSdk(async function* (call, index, tools) {
      if (index === 0) {
        yield msg.init();
        yield msg.tool("d1", `mcp__agent_team__${DELEGATE_TOOL}`, { task: "Build the login form" });
        const report = await tools[DELEGATE_TOOL]!.handler({ task: "Build the login form" });
        yield msg.text(`Team says: ${report.content[0]!.text}`);
        yield msg.result({ total_cost_usd: 0.5 });
      } else {
        yield msg.init("sess-lead", "claude-sonnet-5-5");
        yield msg.tool("a1", "Agent", { subagent_type: "developer-2", description: "Form" });
        yield msg.result({
          result: "Form built and reviewed.",
          total_cost_usd: 1.25,
          session_id: "sess-lead",
        });
      }
    });
    const outcome = await runTeam(
      input(dir, sdk, {
        layered: true,
        maxBudgetUsd: 10,
        config: team({ runner: { teamBudgetUsd: 2 } }),
      }),
    );

    expect(calls).toHaveLength(2);
    const pm = calls[0]!.options;
    expect(Object.keys(pm.agents!)).toEqual(["architect"]);
    expect(Object.keys(pm.mcpServers!)).toEqual(["agent_team"]);
    expect((pm.systemPrompt as { append: string }).append).toContain(
      `call the \`${DELEGATE_TOOL}\` tool`,
    );
    expect(
      await pm.canUseTool!(`mcp__agent_team__${DELEGATE_TOOL}`, {}, {} as never),
    ).toMatchObject({ behavior: "allow" });

    const lead = calls[1]!;
    expect(lead.prompt).toBe("Build the login form");
    expect(Object.keys(lead.options.agents!)).toEqual(["developer-1", "developer-2"]);
    expect(lead.options).toMatchObject({ model: "sonnet", maxBudgetUsd: 2, settingSources: [] });
    expect((lead.options.systemPrompt as { append: string }).append).toContain(
      "You are the lead developer",
    );

    expect(outcome.result).toMatchObject({ ok: true, costUsd: 0.5, teamCostUsd: 1.25 });
    const events = readRun(join(dir, "team"), outcome.log.id)!;
    expect(kinds(events)).toEqual([
      "start",
      "session",
      "tool",
      "delegate",
      "session",
      "tool",
      "delegate-done",
      "text",
      "result",
    ]);
    expect(events.find((e) => e.kind === "tool" && e.tool === "Agent")).toMatchObject({
      agent: "lead-dev",
    });
    expect(events.find((e) => e.kind === "text")).toMatchObject({
      text: "Team says: Form built and reviewed.",
    });
  });

  it("stops handing off work once the budget is spent", async () => {
    const reports: string[] = [];
    const { sdk, calls } = fakeSdk(async function* (_call, index, tools) {
      if (index === 0) {
        for (let i = 0; i < 2; i++)
          reports.push(
            (await tools[DELEGATE_TOOL]!.handler({ task: `Task ${i}` })).content[0]!.text,
          );
        yield msg.result();
      } else {
        yield msg.result({ total_cost_usd: 1.5 });
      }
    });
    await runTeam(input(tempDir(), sdk, { layered: true, maxBudgetUsd: 1 }));
    expect(calls).toHaveLength(2); // the second hand-off never started
    expect(calls[1]!.options.maxBudgetUsd).toBe(1);
    expect(reports[1]).toContain("budget is used up");
  });

  it("needs a lead developer and developers", async () => {
    const { sdk } = fakeSdk(() => [msg.result()]);
    const cfg = config({ roles: { pm: { enabled: true }, developer: { enabled: true } } });
    await expect(runTeam(input(tempDir(), sdk, { layered: true, config: cfg }))).rejects.toThrow(
      RunError,
    );
  });
});

describe("run logs", () => {
  it("lists runs newest first with status and cost, ignoring junk", () => {
    const ws = tempDir();
    const dir = join(ws, "runs");
    const write = (id: string, events: object[]) =>
      writeFileSync(
        join(ws, "runs", `${id}.jsonl`),
        events.map((e) => JSON.stringify(e)).join("\n") + "\n{broken",
      );
    mkdirSync(dir);
    write("2026-11-20T09-00-00-000Z", [
      { kind: "start", at: "a", goal: "First", layered: false, agents: [] },
      {
        kind: "result",
        at: "b",
        ok: true,
        subtype: "success",
        text: "",
        costUsd: 1,
        teamCostUsd: 0.5,
        turns: 3,
        sessionId: "s1",
      },
    ]);
    write("2026-11-21T09-00-00-000Z", [
      { kind: "start", at: "c", goal: "Second", layered: false, agents: [] },
      { kind: "session", at: "d", agent: "pm", sessionId: "s2", model: "m" },
    ]);
    writeFileSync(join(dir, "notes.txt"), "ignore me");

    expect(listRuns(ws)).toEqual([
      {
        id: "2026-11-21T09-00-00-000Z",
        goal: "Second",
        startedAt: "c",
        status: "running",
        sessionId: "s2",
      },
      {
        id: "2026-11-20T09-00-00-000Z",
        goal: "First",
        startedAt: "a",
        status: "done",
        costUsd: 1.5,
        sessionId: "s1",
      },
    ]);
    expect(readRun(ws, "../../etc/passwd")).toBeNull();
    expect(listRuns(tempDir())).toEqual([]);
  });
});

describe("helpers", () => {
  it("summarises tool calls in one line", () => {
    expect(summariseInput("Bash", { command: "npm  test\n--watch=false" })).toBe(
      "npm test --watch=false",
    );
    expect(summariseInput("Edit", { file_path: "src/a.ts", old_string: "x" })).toBe("src/a.ts");
    expect(summariseInput("Agent", { subagent_type: "architect", description: "Design" })).toBe(
      "architect: Design",
    );
    expect(summariseInput("Other", { a: "x".repeat(300) })).toHaveLength(160);
  });

  it("builds SDK MCP config from the team's servers", () => {
    const g = generate(
      team({
        specialists: [
          { id: "dynamics365", enabled: true, mcp: true },
          { id: "aws", enabled: true, mcp: true },
        ],
      }),
      catalog,
    );
    expect(sdkMcpServers(g.mcp, { DATAVERSE_URL: "https://org.crm.dynamics.com" })).toEqual({
      dataverse: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@microsoft/dataverse", "mcp", "https://org.crm.dynamics.com"],
      },
      "aws-knowledge": { type: "http", url: "https://knowledge-mcp.global.api.aws" },
    });
    expect(() => sdkMcpServers(g.mcp, {})).toThrow("Set DATAVERSE_URL before running");
  });
});
