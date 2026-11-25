import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startUiServer, type UiServer } from "../src/server.js";
import { catalog, tempDir } from "./helpers.js";

let project: string;
let ui: UiServer;
const TOKEN = "test-token-123";

beforeEach(async () => {
  process.env.AGENT_TEAM_HOME = tempDir("agent-team-home-");
  // Each test gets its own projects folder, with the starting project inside it.
  project = join(tempDir("agent-team-root-"), "project");
  mkdirSync(project);
  const webDir = tempDir("agent-team-web-");
  writeFileSync(join(webDir, "index.html"), "<!doctype html><title>ui</title>");
  ui = await startUiServer({
    projectDir: project,
    configPath: join(project, "team.json"),
    projectsRoot: join(project, ".."),
    catalog,
    host: "127.0.0.1",
    port: 0,
    token: TOKEN,
    webDir,
    version: "0.0.0-test",
  });
});

afterEach(async () => {
  await ui.close();
  delete process.env.AGENT_TEAM_HOME;
});

const base = () => ui.url.split("/#")[0]!;

async function call(method: string, path: string, body?: unknown, token = TOKEN) {
  const res = await fetch(base() + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => null)) as Record<string, unknown>,
  };
}

const team = {
  version: 1,
  project: { name: "Contoso" },
  roles: { pm: { enabled: true }, developer: { enabled: true, count: 2 } },
};

describe("UI server", () => {
  it("prints a link with the token in the fragment", () => {
    expect(ui.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#token=test-token-123$/);
  });

  it("rejects API calls without the right token", async () => {
    expect((await call("GET", "/api/state", undefined, "")).status).toBe(401);
    expect((await call("GET", "/api/state", undefined, "wrong-token-12")).status).toBe(401);
    expect((await call("PUT", "/api/config", team, "nope")).status).toBe(401);
    expect(existsSync(join(project, "team.json"))).toBe(false);
  });

  it("serves the UI without a token, falls back to index.html, and blocks path tricks", async () => {
    const page = await fetch(`${base()}/some/route`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(await page.text()).toContain("<title>ui</title>");
    const sneaky = await fetch(`${base()}/..%2f..%2fetc%2fpasswd`);
    expect(await sneaky.text()).not.toContain("root:");
  });

  it("reports state for a project with no team.json yet", async () => {
    const { status, body } = await call("GET", "/api/state");
    expect(status).toBe(200);
    expect(body).toMatchObject({
      exists: false,
      config: null,
      projectDir: project,
      version: "0.0.0-test",
    });
    const cat = body.catalog as { roles: { id: string; team: boolean }[]; gates: string[] };
    expect(cat.roles.map((r) => r.id)).toEqual([
      "pm",
      "architect",
      "lead-dev",
      "developer",
      "qa",
      "uat-tester",
      "security",
      "legal",
      "presales",
      "sales",
    ]);
    expect(cat.roles.filter((r) => r.team).map((r) => r.id)).toEqual([
      "developer",
      "qa",
      "uat-tester",
      "sales",
    ]);
    expect((body.profiles as { name: string }[]).map((p) => p.name)).toEqual([
      "consultancy",
      "dev-team",
      "minimal",
    ]);
  });

  it("saves only valid configs, with readable errors otherwise", async () => {
    const bad = await call("PUT", "/api/config", { config: { ...team, roles: {} } });
    expect(bad.status).toBe(422);
    expect(bad.body.errors).toEqual(["roles.pm: The PM runs the team, so it must be enabled"]);
    expect(existsSync(join(project, "team.json"))).toBe(false);

    expect((await call("PUT", "/api/config", { config: team })).status).toBe(200);
    const saved = JSON.parse(readFileSync(join(project, "team.json"), "utf8"));
    expect(saved.$schema).toMatch(/team\.schema\.json$/);
    expect(saved.roles.developer.count).toBe(2);

    const state = await call("GET", "/api/state");
    expect(state.body).toMatchObject({ exists: true, errors: [] });
  });

  it("previews and applies", async () => {
    const preview = await call("POST", "/api/preview", { config: team });
    expect(preview.status).toBe(200);
    expect((preview.body.agents as { name: string }[]).map((a) => a.name)).toEqual([
      "developer-1",
      "developer-2",
    ]);
    const changes = preview.body.changes as { path: string; kind: string; diff: string }[];
    expect(changes.find((c) => c.path === "CLAUDE.md")).toMatchObject({ kind: "create" });
    expect(changes.find((c) => c.path === "CLAUDE.md")!.diff).toContain(
      "+<!-- agent-team:start -->",
    );
    expect(existsSync(join(project, "CLAUDE.md"))).toBe(false);

    const applied = await call("POST", "/api/apply", { config: team });
    expect(applied.status).toBe(200);
    expect((applied.body.written as unknown[]).length).toBe(8); // 2 agents, command, CLAUDE.md, 3 workspace files, manifest
    expect(existsSync(join(project, ".claude/agents/developer-2.md"))).toBe(true);
    expect(existsSync(join(project, "team.json"))).toBe(true);

    const again = await call("POST", "/api/preview", { config: team });
    expect((again.body.changes as { kind: string }[]).every((c) => c.kind === "unchanged")).toBe(
      true,
    );
  });

  it("explains generator errors such as unknown specialists", async () => {
    const res = await call("POST", "/api/preview", {
      config: { ...team, specialists: [{ id: "nope", enabled: true }] },
    });
    expect(res.status).toBe(422);
    expect((res.body.errors as string[])[0]).toMatch(/isn't in the catalog/);
  });

  it("saves, loads and deletes profiles", async () => {
    const saved = await call("POST", "/api/profiles", {
      name: "my-team",
      description: "Mine",
      config: team,
    });
    expect(saved.status).toBe(200);
    expect((await call("POST", "/api/profiles", { name: "my-team", config: team })).status).toBe(
      409,
    );
    expect(
      (await call("POST", "/api/profiles", { name: "my-team", config: team, overwrite: true }))
        .status,
    ).toBe(200);
    expect((await call("POST", "/api/profiles", { name: "Bad Name", config: team })).status).toBe(
      422,
    );

    const loaded = await call("GET", "/api/profiles/my-team");
    expect(loaded.body).toMatchObject({ name: "my-team", roles: { developer: { count: 2 } } });

    expect((await call("DELETE", "/api/profiles/my-team")).status).toBe(200);
    expect((await call("DELETE", "/api/profiles/consultancy")).status).toBe(409);
    expect((await call("GET", "/api/profiles/my-team")).status).toBe(409);
  });

  it("lists runs and returns a run's log", async () => {
    expect((await call("GET", "/api/runs")).body).toEqual([]);
    mkdirSync(join(project, "team/runs"), { recursive: true });
    const id = "2026-11-21T10-00-00-000Z";
    writeFileSync(
      join(project, "team/runs", `${id}.jsonl`),
      [
        {
          kind: "start",
          at: "2026-11-21T10:00:00.000Z",
          goal: "Ship it",
          layered: false,
          agents: [],
        },
        { kind: "text", at: "x", agent: "pm", text: "On it" },
      ]
        .map((e) => JSON.stringify(e))
        .join("\n"),
    );
    const runs = await call("GET", "/api/runs");
    expect(runs.body).toEqual([
      { id, goal: "Ship it", startedAt: "2026-11-21T10:00:00.000Z", status: "running" },
    ]);
    const run = await call("GET", `/api/runs/${id}`);
    expect(run.body).toHaveLength(2);
    expect((await call("GET", "/api/runs/2026-01-01T00-00-00-000Z")).status).toBe(404);
    expect((await call("GET", "/api/runs/..%2f..%2fteam")).status).toBe(404);
  });

  it("switches project: create, open and clone, never into agent-team itself", async () => {
    const root = join(project, "..");
    const created = await call("POST", "/api/project/create", { name: "fresh-repo" });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ dir: join(root, "fresh-repo"), git: { isRepo: true } });
    const state = await call("GET", "/api/state");
    expect(state.body).toMatchObject({
      projectDir: join(root, "fresh-repo"),
      exists: false,
      git: { isRepo: true },
    });
    expect((await call("PUT", "/api/config", { config: team })).status).toBe(200);
    expect(existsSync(join(root, "fresh-repo", "team.json"))).toBe(true);

    expect((await call("POST", "/api/project/create", { name: "fresh-repo" })).status).toBe(422);
    expect(
      (await call("POST", "/api/project/create", { name: "x", github: "internal" })).status,
    ).toBe(400);
    const cloned = await call("POST", "/api/project/clone", {
      url: `file://${join(root, "fresh-repo")}`,
      name: "the-clone",
    });
    expect(cloned.body).toMatchObject({ dir: join(root, "the-clone"), git: { isRepo: true } });

    mkdirSync(join(root, "agent-team-copy"));
    writeFileSync(
      join(root, "agent-team-copy", "package.json"),
      JSON.stringify({ name: "agent-team-monorepo" }),
    );
    const refused = await call("POST", "/api/project/open", {
      path: "agent-team-copy",
      init: true,
    });
    expect(refused.status).toBe(422);
    expect((refused.body.errors as string[])[0]).toMatch(/part of agent-team itself/);

    const listed = (await call("GET", "/api/projects")).body as unknown as { name: string }[];
    expect(listed.map((p) => p.name)).toEqual(expect.arrayContaining(["fresh-repo", "the-clone"]));
    expect(listed.map((p) => p.name)).not.toContain("agent-team-copy");
  });

  it("asks for a project before anything else when started without one", async () => {
    const other = await startUiServer({
      projectDir: null,
      projectsRoot: tempDir(),
      startProblem: "This is agent-team's own folder.",
      catalog,
      host: "127.0.0.1",
      port: 0,
      token: TOKEN,
      version: "0",
    });
    try {
      const base2 = other.url.split("/#")[0]!;
      const get = (p: string) =>
        fetch(base2 + p, { headers: { Authorization: `Bearer ${TOKEN}` } });
      const state = (await (await get("/api/state")).json()) as Record<string, unknown>;
      expect(state).toMatchObject({
        projectDir: null,
        projectProblem: "This is agent-team's own folder.",
        exists: false,
      });
      expect((await get("/api/runs")).status).toBe(409);
    } finally {
      await other.close();
    }
  });

  it("starts, trusts and stops a Remote Control session for the project", async () => {
    // Uses the fake tmux from rc-session.test.ts's approach, through the server's sessionDeps.
    await ui.close();
    const screens = new Map<string, string>();
    const started: string[][] = [];
    ui = await startUiServer({
      projectDir: project,
      projectsRoot: join(project, ".."),
      catalog,
      host: "127.0.0.1",
      port: 0,
      token: TOKEN,
      version: "0",
      sessionDeps: {
        which: (c) => `/usr/bin/${c}`,
        exec: (_cmd, args) => {
          const target = (args[args.indexOf("-t") + 1] ?? "").replace(/^=/, "").replace(/:$/, "");
          if (args[0] === "has-session")
            return { status: screens.has(target) ? 0 : 1, stdout: "", stderr: "" };
          if (args[0] === "new-session") {
            started.push(args);
            screens.set(args[args.indexOf("-s") + 1]!, "Yes, I trust this folder");
          }
          if (args[0] === "send-keys" && args.at(-1) === "Enter")
            screens.set(target, "at https://claude.ai/code/session_X1");
          if (args[0] === "kill-session") screens.delete(target);
          return { status: 0, stdout: screens.get(target) ?? "", stderr: "" };
        },
      },
    });

    expect((await call("GET", "/api/session")).body).toMatchObject({
      available: true,
      running: false,
      upToDate: null,
    });
    expect((await call("POST", "/api/session/start", { goal: "Go" })).status).toBe(409); // no team.json yet

    await call("PUT", "/api/config", { config: team });
    expect((await call("GET", "/api/session")).body).toMatchObject({ upToDate: false });
    const stale = await call("POST", "/api/session/start", { goal: "Go" });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatch(/out of date/);

    const start = await call("POST", "/api/session/start", {
      goal: "Build the thing",
      apply: true,
      permissionMode: "plan",
    });
    expect(start.status).toBe(200);
    expect(start.body).toMatchObject({ running: true, waitingFor: "trust", upToDate: true });
    expect(existsSync(join(project, ".claude/commands/team.md"))).toBe(true);
    expect(started[0]!.slice(-4)).toEqual([
      "--remote-control=Contoso team",
      "--permission-mode",
      "plan",
      "/team Build the thing",
    ]);

    expect((await call("POST", "/api/session/trust")).body).toMatchObject({
      url: "https://claude.ai/code/session_X1",
    });
    expect((await call("POST", "/api/session/trust")).status).toBe(409);
    expect((await call("POST", "/api/session/stop")).body).toMatchObject({ running: false });
  });

  it("rejects non-JSON and oversized bodies", async () => {
    const res = await fetch(`${base()}/api/config`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "text/plain" },
      body: "{}",
    });
    expect(res.status).toBe(415);
    const big = await call("PUT", "/api/config", { config: team, padding: "x".repeat(1_100_000) });
    expect(big.status).toBe(413);
    expect((await call("GET", "/api/nope")).status).toBe(404);
  });
});
