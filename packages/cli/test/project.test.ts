import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  agentTeamRootOf,
  cloneProject,
  createProject,
  gitInfo,
  initialProject,
  listProjects,
  openProject,
  projectProblem,
  ProjectError,
  shareableRemote,
} from "../src/project.js";
import { repoRoot, tempDir } from "./helpers.js";

const git = (cwd: string, ...args: string[]) =>
  spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    encoding: "utf8",
  });

function fakeAgentTeam(): string {
  const dir = tempDir();
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "agent-team-monorepo" }));
  mkdirSync(join(dir, "packages/cli"), { recursive: true });
  return dir;
}

const originalPath = process.env.PATH;
afterEach(() => {
  process.env.PATH = originalPath;
});

describe("agent-team's own folder", () => {
  it("is recognised from inside, and refused as a project", () => {
    expect(agentTeamRootOf(join(repoRoot, "packages/schema/src"))).toBe(repoRoot);
    // The CLI package is agent-team too (that's what an npm installation looks like).
    expect(agentTeamRootOf(join(repoRoot, "packages/cli/src"))).toBe(
      join(repoRoot, "packages/cli"),
    );
    const own = fakeAgentTeam();
    expect(agentTeamRootOf(join(own, "packages/cli"))).toBe(own);
    expect(projectProblem(join(own, "packages/cli"))).toMatch(/part of agent-team itself/);
    expect(agentTeamRootOf(tempDir())).toBeNull();
    expect(projectProblem(tempDir())).toBeNull();
  });

  it("keeps projects inside the projects folder", () => {
    const root = tempDir();
    expect(projectProblem(join(root, "a"), root)).toBeNull();
    expect(projectProblem(tempDir(), root)).toMatch(/outside the projects folder/);
  });
});

describe("openProject", () => {
  it("opens a git repository, and only makes a plain folder a repository when asked", () => {
    const root = tempDir();
    mkdirSync(join(root, "plain"));
    expect(() => openProject(root, "plain")).toThrow(/isn't a git repository/);
    expect(openProject(root, "plain", { init: true }).git.isRepo).toBe(true);
    expect(openProject(root, join(root, "plain")).dir).toBe(join(root, "plain"));
    expect(() => openProject(root, "missing")).toThrow(/no folder/);
    expect(() => openProject(root, "../../etc")).toThrow(ProjectError);
  });

  it("refuses agent-team's folder even when it's inside the projects folder", () => {
    const own = fakeAgentTeam();
    expect(() => openProject(join(own, ".."), own, { init: true })).toThrow(
      /part of agent-team itself/,
    );
  });
});

describe("cloneProject", () => {
  it("clones into the projects folder and records the remote", () => {
    const source = tempDir();
    git(source, "init", "-b", "main");
    writeFileSync(join(source, "README.md"), "hi");
    git(source, "add", ".");
    git(source, "commit", "-m", "first");

    const root = tempDir();
    const { dir, git: info } = cloneProject(root, `file://${source}`, "my-copy");
    expect(dir).toBe(join(root, "my-copy"));
    expect(readFileSync(join(dir, "README.md"), "utf8")).toBe("hi");
    expect(info).toEqual({ isRepo: true, remote: `file://${source}` });

    expect(() => cloneProject(root, `file://${source}`, "my-copy")).toThrow(/already exists/);
    expect(() => cloneProject(root, "--upload-pack=evil")).toThrow(/repository address/);
    expect(() => cloneProject(root, "/etc")).toThrow(/repository address/);
    expect(() => cloneProject(root, `file://${source}`, "../escape")).toThrow(/usable folder name/);
  });
});

describe("createProject", () => {
  it("creates a repository with a first commit", () => {
    const root = tempDir();
    const { dir, git: info } = createProject(root, "new-thing", { description: "A test" });
    expect(info).toEqual({ isRepo: true });
    expect(readFileSync(join(dir, "README.md"), "utf8")).toContain("A test");
    expect(git(dir, "log", "--oneline").stdout).toContain("Initial commit");
    expect(() => createProject(root, "new-thing")).toThrow(/isn't empty/);
    expect(() => createProject(root, "bad name!")).toThrow(/usable folder name/);
  });

  it("creates it on GitHub with gh, and explains when that fails", () => {
    const bin = tempDir();
    const log = join(bin, "gh.log");
    writeFileSync(
      join(bin, "gh"),
      `#!/bin/sh\necho "$@" > ${log}\ncase "$*" in *fail-me*) echo "not signed in" >&2; exit 1;; esac\ngit -C "$6" remote add origin https://github.com/jay1459/$3.git\n`,
    );
    chmodSync(join(bin, "gh"), 0o755);
    process.env.PATH = `${bin}:${originalPath}`;

    const root = tempDir();
    const made = createProject(root, "shiny", { github: "private" });
    expect(readFileSync(log, "utf8").trim()).toBe(
      `repo create shiny --private --source ${made.dir} --remote origin --push`,
    );
    expect(made.git.remote).toBe("https://github.com/jay1459/shiny.git");

    expect(() => createProject(root, "fail-me", { github: "public" })).toThrow(
      /creating it on GitHub failed: not signed in/,
    );
    expect(existsSync(join(root, "fail-me/.git"))).toBe(true);
  });
});

describe("helpers", () => {
  it("lists project folders without agent-team itself", () => {
    const root = tempDir();
    createProject(root, "repo-a");
    mkdirSync(join(root, "plain"));
    writeFileSync(join(root, "plain", "team.json"), "{}");
    mkdirSync(join(root, "agent-team"));
    writeFileSync(
      join(root, "agent-team", "package.json"),
      JSON.stringify({ name: "agent-team-monorepo" }),
    );
    expect(listProjects(root).map((p) => [p.name, p.isRepo, p.hasTeam])).toEqual([
      ["plain", false, true],
      ["repo-a", true, false],
    ]);
  });

  it("only records remotes that make sense elsewhere, without credentials", () => {
    expect(shareableRemote("https://token@github.com/a/b.git")).toBe("https://github.com/a/b.git");
    expect(shareableRemote("git@github.com:a/b.git")).toBe("git@github.com:a/b.git");
    expect(shareableRemote("file:///tmp/x")).toBeUndefined();
    expect(shareableRemote(undefined)).toBeUndefined();
  });

  it("picks the UI's starting project", () => {
    const own = fakeAgentTeam();
    expect(initialProject({ cwd: own })).toMatchObject({
      projectDir: null,
      problem: expect.stringMatching(/agent-team itself/),
    });
    const projects = tempDir();
    const repo = createProject(projects, "r").dir;
    expect(initialProject({ cwd: repo })).toEqual({ projectDir: repo, root: projects });
    expect(initialProject({ cwd: projects })).toEqual({ projectDir: null, root: projects });
    expect(initialProject({ cwd: projects, dir: "r" })).toEqual({
      projectDir: repo,
      root: projects,
    });
    expect(initialProject({ cwd: own, root: projects })).toMatchObject({
      projectDir: null,
      root: projects,
    });
    expect(gitInfo(projects)).toEqual({ isRepo: false });
  });
});
