import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main, sessionCli } from "../src/cli.js";
import { userCommandPath } from "../src/team-command.js";
import { createProject } from "../src/project.js";
import { catalog, fakeIo, fakeTmux, tempDir } from "./helpers.js";

const original = { ...sessionCli };
let tmux: ReturnType<typeof fakeTmux>;
beforeEach(() => {
  tmux = fakeTmux();
  sessionCli.deps = () => tmux.deps;
  sessionCli.sleep = async () => undefined;
  process.env.CLAUDE_CONFIG_DIR = tempDir("claude-config-");
});
afterEach(() => {
  Object.assign(sessionCli, original);
  delete process.env.CLAUDE_CONFIG_DIR;
});

function projectsWithTeam() {
  const root = tempDir();
  const shop = createProject(root, "shop").dir;
  writeFileSync(
    join(shop, "team.json"),
    JSON.stringify({
      version: 1,
      project: { name: "Shop" },
      roles: { pm: { enabled: true }, developer: { enabled: true } },
    }),
  );
  createProject(root, "no-team");
  return { root, shop };
}

const run = async (cwd: string, argv: string[]) => {
  const io = fakeIo(cwd);
  const code = await main(argv, io.io, catalog);
  return { code, ...io };
};

describe("start / session / projects", () => {
  it("lists only the projects with a team, with their session state", async () => {
    const { root, shop } = projectsWithTeam();
    const before = await run(root, ["projects"]);
    expect(before.out).toEqual([expect.stringMatching(new RegExp(`^shop\\s+${shop}$`))]);
    expect((await run(tempDir(), ["projects"])).text()).toContain("No projects with a team");

    await run(root, ["start", "-C", "shop", "Go"]);
    await run(root, ["session", "trust", "-C", "shop"]);
    expect((await run(root, ["projects"])).text()).toContain(
      "session running: https://claude.ai/code/session_ABC123",
    );
  });

  it("applies the team, starts the session and walks through the trust question", async () => {
    const { root, shop } = projectsWithTeam();
    const started = await run(root, [
      "start",
      "-C",
      "shop",
      "Build",
      "the",
      "checkout",
      "--permission-mode",
      "acceptEdits",
    ]);
    expect(started.code).toBe(0);
    expect(started.text()).toContain("Applied the team's files");
    expect(started.text()).toContain("asking whether you trust");
    expect(existsSync(join(shop, ".claude/commands/team.md"))).toBe(true);
    const call = tmux.calls.find((c) => c[1] === "new-session")!;
    expect(call.slice(-4)).toEqual([
      "--remote-control=Shop team",
      "--permission-mode",
      "acceptEdits",
      "/team Build the checkout",
    ]);

    expect((await run(root, ["start", "-C", "shop", "Again"])).errors()).toContain(
      "already running",
    );

    const trusted = await run(root, ["session", "trust", "-C", "shop"]);
    expect(trusted.text()).toContain("https://claude.ai/code/session_ABC123");
    expect((await run(root, ["session", "-C", "shop"])).text()).toContain("The team is running");
    expect((await run(root, ["session", "stop", "-C", "shop"])).text()).toBe(
      "Stopped the team's session.",
    );
    expect((await run(root, ["session", "status", "-C", "shop"])).text()).toContain(
      "No team session is running",
    );
  });

  it("refuses bad input", async () => {
    const { root } = projectsWithTeam();
    expect((await run(root, ["start", "-C", "shop"])).code).toBe(2);
    expect(
      (await run(root, ["start", "-C", "shop", "x", "--permission-mode", "bypassPermissions"]))
        .code,
    ).toBe(2);
    expect((await run(root, ["start", "-C", "no-team", "x"])).code).toBe(1);
    expect((await run(root, ["session", "explode", "-C", "shop"])).code).toBe(2);
    expect((await run(root, ["session", "trust", "-C", "shop"])).errors()).toContain(
      "isn't asking",
    );
  });
});

describe("install-command", () => {
  it("installs, updates and removes the user-level /team command", async () => {
    sessionCli.script = () => "/opt/agent team/cli.js";
    const dir = tempDir();
    const installed = await run(dir, ["install-command"]);
    expect(installed.code).toBe(0);
    const path = userCommandPath();
    expect(path).toBe(join(process.env.CLAUDE_CONFIG_DIR!, "commands", "team.md"));
    const text = readFileSync(path, "utf8");
    expect(text).toContain('argument-hint: "[project] <goal>"');
    expect(text).toContain(
      `${process.execPath} '/opt/agent team/cli.js' start -C <project folder> "<goal>"`,
    );
    expect(text).toContain("you are the project manager it describes");
    expect(text).not.toMatch(/\{\{\w+\}\}/);

    expect((await run(dir, ["install-command"])).text()).toContain("Updated");
    expect((await run(dir, ["install-command", "--uninstall"])).text()).toContain("Removed");
    expect(existsSync(path)).toBe(false);
    expect((await run(dir, ["install-command", "--uninstall"])).text()).toContain(
      "isn't installed",
    );
  });

  it("won't overwrite someone else's /team without --force", async () => {
    const path = userCommandPath();
    const dir = tempDir();
    await run(dir, ["install-command"]);
    writeFileSync(path, "my own team command");
    expect((await run(dir, ["install-command"])).code).toBe(1);
    expect((await run(dir, ["install-command", "--uninstall"])).code).toBe(1);
    expect(readFileSync(path, "utf8")).toBe("my own team command");
    expect((await run(dir, ["install-command", "--force"])).code).toBe(0);
  });
});
