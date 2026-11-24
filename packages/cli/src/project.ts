import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/**
 * Where the team's work goes. It must be a project of its own (an existing repo, a clone, or a new
 * repo), never agent-team's own folder, so the team's output can't end up in this tool's repo.
 */

export class ProjectError extends Error {}

const AGENT_TEAM_PACKAGES = new Set(["agent-team-monorepo", "@jay1459/agent-team"]);

/** The agent-team checkout or installation that contains `dir`, if any. */
export function agentTeamRootOf(dir: string): string | null {
  let current = resolve(dir);
  for (;;) {
    const pkg = join(current, "package.json");
    if (existsSync(pkg)) {
      try {
        const name = (JSON.parse(readFileSync(pkg, "utf8")) as { name?: string }).name;
        if (name && AGENT_TEAM_PACKAGES.has(name)) return current;
      } catch {
        // not a package we care about
      }
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function git(args: string[], cwd?: string) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 120_000 });
  if (r.error) throw new ProjectError(`Couldn't run git: ${r.error.message}`);
  return { ok: r.status === 0, out: r.stdout.trim(), err: r.stderr.trim() };
}

export type GitInfo = { isRepo: boolean; remote?: string };

export function gitInfo(dir: string): GitInfo {
  if (!existsSync(dir)) return { isRepo: false };
  const inside = git(["rev-parse", "--show-toplevel"], dir);
  if (!inside.ok) return { isRepo: false };
  const remote = git(["remote", "get-url", "origin"], dir);
  return { isRepo: true, ...(remote.ok && remote.out ? { remote: remote.out } : {}) };
}

/** A repository address safe to record in team.json, or undefined (local paths aren't recorded). */
export function shareableRemote(remote: string | undefined): string | undefined {
  return remote && /^(https:\/\/|ssh:\/\/|git@)\S+$/.test(remote)
    ? remote.replace(/^https:\/\/[^@/]+@/, "https://")
    : undefined;
}

function real(path: string): string {
  return existsSync(path) ? realpathSync(path) : resolve(path);
}

function inside(root: string, path: string): boolean {
  const rel = relative(real(root), real(path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel) && !rel.startsWith(sep));
}

/** Why `dir` can't be the team's project, or null if it can. */
export function projectProblem(dir: string, root?: string): string | null {
  const own = agentTeamRootOf(dir);
  if (own) {
    return `${dir} is part of agent-team itself (${own}). The team's work needs its own repository: open an existing one, clone one, or create a new one.`;
  }
  if (root && !inside(root, dir)) return `${dir} is outside the projects folder ${root}.`;
  return null;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

function checkName(name: string): string {
  const trimmed = name.trim();
  if (!NAME.test(trimmed) || trimmed.endsWith(".git") || trimmed === "." || trimmed === "..") {
    throw new ProjectError(
      `"${name}" isn't a usable folder name: use letters, digits, dots, hyphens and underscores.`,
    );
  }
  return trimmed;
}

/** Resolve a path typed by the user against the projects folder. */
export function resolveInRoot(root: string, path: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(root, path);
}

/** Use an existing folder. With `init`, a folder that isn't a git repository yet becomes one. */
export function openProject(
  root: string,
  path: string,
  opts: { init?: boolean } = {},
): { dir: string; git: GitInfo } {
  const dir = resolveInRoot(root, path.trim());
  if (!existsSync(dir) || !statSync(dir).isDirectory())
    throw new ProjectError(`There's no folder at ${dir}.`);
  const problem = projectProblem(dir, root);
  if (problem) throw new ProjectError(problem);
  let info = gitInfo(dir);
  if (!info.isRepo) {
    if (!opts.init) {
      throw new ProjectError(
        `${dir} isn't a git repository. Tick "make it a git repository" to set one up there.`,
      );
    }
    const init = git(["init", "-b", "main"], dir);
    if (!init.ok) throw new ProjectError(`git init failed: ${init.err}`);
    info = gitInfo(dir);
  }
  return { dir, git: info };
}

const CLONE_URL = /^(https:\/\/|ssh:\/\/|file:\/\/|git@[^\s:]+:)[^\s]+$/;

/** Clone a repository into a new folder inside the projects folder. */
export function cloneProject(
  root: string,
  url: string,
  name?: string,
): { dir: string; git: GitInfo } {
  const address = url.trim();
  if (!CLONE_URL.test(address)) {
    throw new ProjectError("Use an https://, ssh://, git@host: or file:// repository address.");
  }
  const folder = checkName(
    name?.trim() ||
      basename(address.replace(/\/+$/, ""))
        .replace(/\.git$/, "")
        .replace(/^.*:/, ""),
  );
  const dir = join(root, folder);
  if (existsSync(dir))
    throw new ProjectError(
      `${dir} already exists. Choose another folder name, or open it instead.`,
    );
  const problem = projectProblem(dir, root);
  if (problem) throw new ProjectError(problem);
  mkdirSync(root, { recursive: true });
  const r = git(["clone", "--", address, dir]);
  if (!r.ok) throw new ProjectError(`git clone failed: ${r.err || r.out}`);
  return { dir, git: gitInfo(dir) };
}

export type GithubVisibility = "private" | "public";

/** Create a new git repository (with a first commit), optionally also on GitHub with the gh CLI. */
export function createProject(
  root: string,
  name: string,
  opts: { github?: GithubVisibility; description?: string } = {},
): { dir: string; git: GitInfo } {
  const folder = checkName(name);
  const dir = join(root, folder);
  if (existsSync(dir) && readdirSync(dir).length) {
    throw new ProjectError(
      `${dir} already exists and isn't empty. Choose another name, or open it instead.`,
    );
  }
  const problem = projectProblem(dir, root);
  if (problem) throw new ProjectError(problem);

  mkdirSync(dir, { recursive: true });
  const step = (args: string[]) => {
    const r = git(args, dir);
    if (!r.ok) throw new ProjectError(`git ${args[0]} failed: ${r.err || r.out}`);
  };
  step(["init", "-b", "main"]);
  writeFileSync(
    join(dir, "README.md"),
    `# ${folder}\n\n${opts.description ?? ""}\n`.replace(/\n\n\n$/, "\n"),
  );
  step(["add", "README.md"]);
  // Use the machine's git identity when there is one, otherwise a neutral one for this first commit.
  const hasIdentity = git(["config", "user.email"], dir).ok;
  step([
    ...(hasIdentity ? [] : ["-c", "user.name=agent-team", "-c", "user.email=agent-team@localhost"]),
    "commit",
    "-m",
    "Initial commit",
  ]);

  if (opts.github) {
    const gh = spawnSync(
      "gh",
      [
        "repo",
        "create",
        folder,
        `--${opts.github}`,
        "--source",
        dir,
        "--remote",
        "origin",
        "--push",
        ...(opts.description ? ["--description", opts.description] : []),
      ],
      { encoding: "utf8", timeout: 120_000 },
    );
    if (gh.error || gh.status !== 0) {
      const why = gh.error ? gh.error.message : (gh.stderr || gh.stdout).trim();
      throw new ProjectError(
        `The local repository was created at ${dir}, but creating it on GitHub failed: ${why}. Is the GitHub CLI (gh) installed and signed in? You can open the folder and add a remote later.`,
      );
    }
  }
  return { dir, git: gitInfo(dir) };
}

export type ProjectListing = { name: string; dir: string; isRepo: boolean; hasTeam: boolean };

/** Folders in the projects folder, for the "open existing" picker. agent-team's own folder is left out. */
export function listProjects(root: string): ProjectListing[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => join(root, e.name))
    .filter((dir) => !agentTeamRootOf(dir))
    .map((dir) => ({
      name: basename(dir),
      dir,
      isRepo: existsSync(join(dir, ".git")),
      hasTeam: existsSync(join(dir, "team.json")),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The project `agent-team ui` starts on, and the folder new projects go in. An explicit -C is used
 * unless it's agent-team's own folder; otherwise the current folder is used only if it already
 * looks like a project. With no usable project, the UI asks for one.
 */
export function initialProject(opts: { cwd: string; dir?: string; root?: string }): {
  projectDir: string | null;
  root: string;
  problem?: string;
} {
  const candidate = resolve(opts.cwd, opts.dir ?? ".");
  const own = agentTeamRootOf(candidate);
  const root = opts.root
    ? resolve(opts.cwd, opts.root)
    : own
      ? dirname(own)
      : opts.dir
        ? dirname(candidate)
        : candidate;
  if (own) return { projectDir: null, root, problem: projectProblem(candidate) ?? undefined };
  if (opts.dir) return { projectDir: candidate, root };
  const looksLikeProject = existsSync(join(candidate, "team.json")) || gitInfo(candidate).isRepo;
  return looksLikeProject
    ? { projectDir: candidate, root: dirname(candidate) }
    : { projectDir: null, root };
}
