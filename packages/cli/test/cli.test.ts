import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { catalog, fakeIo, tempDir } from "./helpers.js";

let home: string;
beforeEach(() => {
  home = tempDir("agent-team-home-");
  process.env.AGENT_TEAM_HOME = home;
});
afterEach(() => {
  delete process.env.AGENT_TEAM_HOME;
});

const run = (dir: string, argv: string[], answers: boolean[] = []) => {
  const io = fakeIo(dir, answers);
  return main(argv, io.io, catalog).then((code) => ({ code, ...io }));
};

describe("agent-team CLI", () => {
  it("prints help and version", async () => {
    const dir = tempDir();
    expect((await run(dir, ["--help"])).text()).toContain("agent-team init");
    expect((await run(dir, ["--version"])).text()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("rejects unknown commands and options with exit code 2", async () => {
    const dir = tempDir();
    expect((await run(dir, ["frobnicate"])).code).toBe(2);
    expect((await run(dir, ["apply", "--bogus"])).code).toBe(2);
  });

  it("runs init → validate → apply", async () => {
    const dir = tempDir();
    const init = await run(dir, ["init", "--profile", "dev-team", "--name", "Contoso"]);
    expect(init.code).toBe(0);
    const config = JSON.parse(readFileSync(join(dir, "team.json"), "utf8"));
    expect(config.$schema).toMatch(/team\.schema\.json$/);
    expect(config.extends).toBe("dev-team");
    expect(config.project).toEqual({ name: "Contoso" });

    expect((await run(dir, ["init"])).code).toBe(1); // already exists

    const validate = await run(dir, ["validate"]);
    expect(validate.code).toBe(0);
    expect(validate.text()).toContain("5 agents (PM + 4)");

    const declined = await run(dir, ["apply"], [false]);
    expect(declined.code).toBe(1);
    expect(existsSync(join(dir, "CLAUDE.md"))).toBe(false);

    const applied = await run(dir, ["apply"], [true]);
    expect(applied.code).toBe(0);
    expect(existsSync(join(dir, ".claude/agents/developer.md"))).toBe(true);
    expect(existsSync(join(dir, ".claude/agents/qa.md"))).toBe(true);

    const again = await run(dir, ["apply"]);
    expect(again.code).toBe(0);
    expect(again.text()).toContain("Everything is up to date.");
  });

  it("init without a profile creates a minimal team without 'extends'", async () => {
    const dir = tempDir();
    expect((await run(dir, ["init"])).code).toBe(0);
    const config = JSON.parse(readFileSync(join(dir, "team.json"), "utf8"));
    expect(config.extends).toBeUndefined();
    expect(Object.keys(config.roles)).toEqual(["pm", "developer"]);
  });

  it("creates or clones the team's repository with init, and refuses agent-team's own folder", async () => {
    const root = tempDir();
    const created = await run(root, ["init", "--new", "my-app", "--profile", "dev-team"]);
    expect(created.code).toBe(0);
    expect(created.text()).toContain(`Created ${join(root, "my-app")}`);
    expect(JSON.parse(readFileSync(join(root, "my-app", "team.json"), "utf8")).extends).toBe(
      "dev-team",
    );
    expect(existsSync(join(root, "my-app", ".git"))).toBe(true);

    const cloned = await run(root, [
      "init",
      "--clone",
      `file://${join(root, "my-app")}`,
      "--into",
      "copy",
      "--force",
    ]);
    expect(cloned.code).toBe(0);
    expect(existsSync(join(root, "copy", "team.json"))).toBe(true);

    expect((await run(root, ["init", "--new", "a", "--clone", "b"])).code).toBe(2);
    expect((await run(root, ["init", "--github", "private"])).code).toBe(2);

    const own = tempDir();
    writeFileSync(join(own, "package.json"), JSON.stringify({ name: "agent-team-monorepo" }));
    const refused = await run(own, ["init"]);
    expect(refused.code).toBe(2);
    expect(refused.errors()).toContain("part of agent-team itself");
    expect((await run(own, ["apply", "--yes"])).code).toBe(2);
    expect(existsSync(join(own, "team.json"))).toBe(false);
  });

  it("dry-run shows a diff and writes nothing", async () => {
    const dir = tempDir();
    await run(dir, ["init"]);
    const dry = await run(dir, ["apply", "--dry-run"]);
    expect(dry.code).toBe(0);
    expect(dry.text()).toContain("+++ b/.claude/agents/developer.md");
    expect(existsSync(join(dir, ".claude"))).toBe(false);
  });

  it("refuses to apply without a terminal unless --yes is given", async () => {
    const dir = tempDir();
    await run(dir, ["init"]);
    const io = fakeIo(dir);
    io.io.isTTY = false;
    expect(await main(["apply"], io.io, catalog)).toBe(1);
    expect(io.errors()).toContain("--yes");
    expect(await main(["apply", "--yes"], io.io, catalog)).toBe(0);
  });

  it("reports config errors clearly", async () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "team.json"),
      JSON.stringify({ version: 1, project: { name: "x" }, roles: {} }),
    );
    const out = await run(dir, ["validate"]);
    expect(out.code).toBe(1);
    expect(out.errors()).toContain("roles.pm: The PM runs the team, so it must be enabled");

    writeFileSync(join(dir, "team.json"), "{");
    expect((await run(dir, ["apply", "--yes"])).errors()).toContain("Not valid JSON");

    expect((await run(tempDir(), ["validate"])).errors()).toContain("agent-team init");
  });

  it("saves, lists, shows and deletes profiles; user profiles shadow built-ins", async () => {
    const dir = tempDir();
    await run(dir, ["init", "--profile", "consultancy"]);
    expect((await run(dir, ["profile", "save", "my-team", "--description", "Mine"])).code).toBe(0);
    expect((await run(dir, ["profile", "save", "my-team"])).code).toBe(1);
    expect((await run(dir, ["profile", "save", "my-team", "--force"])).code).toBe(0);

    const list = (await run(dir, ["profile", "list"])).text();
    expect(list).toMatch(/^consultancy\s+built-in/m);
    expect(list).toMatch(/^my-team\s+user/m);

    const shown = JSON.parse((await run(dir, ["profile", "show", "my-team"])).text());
    expect(shown.roles.sales.count).toBe(2);

    const fresh = tempDir();
    await run(fresh, ["init", "--profile", "my-team"]);
    expect(JSON.parse(readFileSync(join(fresh, "team.json"), "utf8")).extends).toBe("my-team");

    expect((await run(dir, ["profile", "delete", "my-team"])).code).toBe(0);
    expect((await run(dir, ["profile", "delete", "consultancy"])).code).toBe(1);
    expect((await run(dir, ["profile", "save", "Bad Name"])).code).toBe(1);
    expect((await run(dir, ["init", "--profile", "missing", "--force"])).errors()).toContain(
      "No profile called",
    );
  });
});
