#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { profileFromTeamConfig, teamConfigFromProfile, type TeamConfig } from "@agent-team/schema";
import { loadCatalog, type Catalog } from "./catalog.js";
import { CONFIG_FILE, readConfigFile, writeConfigFile } from "./config-file.js";
import { generate } from "./generate.js";
import { applyPlan, diffChange, pendingChanges, planApply, summarisePlan } from "./plan.js";
import { deleteProfile, listProfiles, loadProfile, saveProfile } from "./profiles.js";
import { isLoopback, startUiServer } from "./server.js";
import {
  defaultSessionDeps,
  SESSION_PERMISSION_MODES,
  SessionError,
  sessionStatus,
  startSession,
  stopSession,
  trustFolder,
  type SessionDeps,
  type SessionPermissionMode,
  type SessionStatus,
} from "./rc-session.js";
import {
  cliInvocation,
  CommandError,
  installUserCommand,
  uninstallUserCommand,
} from "./team-command.js";
import {
  cloneProject,
  createProject,
  gitInfo,
  initialProject,
  listProjects,
  projectProblem,
  shareableRemote,
  ProjectError,
  type GithubVisibility,
} from "./project.js";
import { defaultDeps, formatChecks, runDoctor, type DoctorDeps } from "./doctor.js";
import { MissingEnvError } from "./run/mcp-config.js";
import { listRuns, type RunEvent } from "./run/run-log.js";
import { loadSdk, RunError, runTeam, type Sdk } from "./run/runner.js";

export const DEFAULT_UI_PORT = 7420;

export type Io = {
  out: (text: string) => void;
  err: (text: string) => void;
  confirm: (question: string) => Promise<boolean>;
  cwd: string;
  isTTY: boolean;
};

export class UsageError extends Error {}

export const HELP = `agent-team: run a project with a team of Claude Code agents led by a PM

Usage
  agent-team init [--profile <name>] [--name <project>] [--force]
                              Create team.json, from a profile if given
  agent-team init --new <folder> [--github private|public] [--profile <name>]
                              Create a new git repository for the team's work, then team.json
  agent-team init --clone <url> [--into <folder>] [--profile <name>]
                              Clone an existing repository for the team's work, then team.json
  agent-team validate         Check team.json
  agent-team apply [--yes] [--dry-run] [--diff]
                              Write the agent files Claude Code reads
  agent-team profile list     List built-in and saved profiles
  agent-team profile show <name>
  agent-team profile save <name> [--description <text>] [--force]
                              Save this project's team as a reusable profile
  agent-team profile delete <name>
  agent-team doctor           Check this project is ready to run
  agent-team run "<goal>" [--budget <usd>] [--layered] [--yes]
                              Run the team unattended on the Claude Agent SDK
  agent-team run --continue "<reply>"
                              Continue the latest run (e.g. answer the PM's question)
  agent-team runs             List runs and what they cost
  agent-team start "<goal>" [--name <name>] [--permission-mode <mode>]
                              Start the team in a Claude Code session with Remote Control
  agent-team session [status|trust|stop]
                              Check, answer the folder-trust question for, or stop that session
  agent-team projects         List the projects with a team in this folder
  agent-team install-command [--force] [--uninstall]
                              Install /team for Claude Code sessions started in any folder
  agent-team ui [--host <addr>] [--port <n>] [--projects-root <folder>]
                              Edit the team in your browser (default http://127.0.0.1:7420)

Options
  -C, --dir <path>     Project folder (default: current folder)
  -c, --config <file>  Config file (default: <project>/team.json)
  -h, --help           Show this help
  -v, --version        Show the version

Then run \`claude\` in the project and type /team <goal>.`;

function version(): string {
  const pkg = join(fileURLToPath(import.meta.url), "../../package.json");
  return (JSON.parse(readFileSync(pkg, "utf8")) as { version: string }).version;
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      dir: { type: "string", short: "C" },
      config: { type: "string", short: "c" },
      profile: { type: "string", short: "p" },
      name: { type: "string" },
      new: { type: "string" },
      clone: { type: "string" },
      into: { type: "string" },
      github: { type: "string" },
      "projects-root": { type: "string" },
      description: { type: "string" },
      force: { type: "boolean", short: "f" },
      yes: { type: "boolean", short: "y" },
      "dry-run": { type: "boolean" },
      diff: { type: "boolean" },
      host: { type: "string" },
      budget: { type: "string" },
      "permission-mode": { type: "string" },
      wait: { type: "string" },
      uninstall: { type: "boolean" },
      layered: { type: "boolean" },
      flat: { type: "boolean" },
      continue: { type: "boolean" },
      resume: { type: "string" },
      port: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
}

type Args = ReturnType<typeof parse>;

function paths(args: Args, io: Io) {
  const projectDir = resolve(io.cwd, args.values.dir ?? ".");
  const configPath = resolve(projectDir, args.values.config ?? CONFIG_FILE);
  return { projectDir, configPath };
}

/** Load and validate team.json, printing errors. Returns null when it can't be used. */
function loadConfig(configPath: string, io: Io): TeamConfig | null {
  const file = readConfigFile(configPath);
  if (!file.exists) {
    io.err(`No ${basename(configPath)} at ${configPath}. Run \`agent-team init\` to create one.`);
    return null;
  }
  if (!file.result.ok) {
    io.err(`${configPath} has problems:\n${file.result.errors.map((e) => `  - ${e}`).join("\n")}`);
    return null;
  }
  return file.result.value;
}

/** The team's work must not land in agent-team's own folder. */
function refuseAgentTeamFolder(projectDir: string): void {
  const problem = projectProblem(projectDir);
  if (problem)
    throw new UsageError(
      `${problem}\nPoint agent-team at your project with -C <folder>, or use init --new / --clone.`,
    );
}

async function cmdInit(args: Args, io: Io, catalog: Catalog): Promise<number> {
  const { new: newRepo, clone, github, into } = args.values;
  if (newRepo && clone) throw new UsageError("Choose --new or --clone, not both.");
  if (github && !newRepo) throw new UsageError("--github only goes with --new.");
  if (github && github !== "private" && github !== "public")
    throw new UsageError('--github must be "private" or "public".');
  if (into && !clone) throw new UsageError("--into only goes with --clone.");

  let { projectDir, configPath } = paths(args, io);
  if (newRepo || clone) {
    // New and cloned repositories go inside the -C folder (default: the current folder).
    const root = projectDir;
    const made = newRepo
      ? createProject(root, newRepo, github ? { github: github as GithubVisibility } : {})
      : cloneProject(root, clone!, into);
    io.out(
      `${newRepo ? "Created" : "Cloned"} ${made.dir}${made.git.remote ? ` (${made.git.remote})` : ""}.`,
    );
    projectDir = made.dir;
    configPath = join(projectDir, CONFIG_FILE);
  }
  refuseAgentTeamFolder(projectDir);

  if (readConfigFile(configPath).exists && !args.values.force) {
    io.err(`${configPath} already exists (use --force to replace it).`);
    return 1;
  }
  const repository = shareableRemote(gitInfo(projectDir).remote);
  const project = {
    name: args.values.name ?? basename(projectDir),
    ...(repository ? { repository } : {}),
  };
  const config = args.values.profile
    ? teamConfigFromProfile(loadProfile(args.values.profile, catalog), project)
    : teamConfigFromProfile(loadProfile("minimal", catalog), project);
  if (!args.values.profile) delete config.extends;
  writeConfigFile(configPath, config);
  io.out(
    `Created ${configPath}${args.values.profile ? ` from profile "${args.values.profile}"` : ""}.`,
  );
  if (!gitInfo(projectDir).isRepo) {
    io.err(
      `! ${projectDir} isn't a git repository. Run \`git init\` there so the team's work is tracked.`,
    );
  }
  io.out("Edit it, then run `agent-team apply`.");
  return 0;
}

async function cmdValidate(args: Args, io: Io, catalog: Catalog): Promise<number> {
  const { configPath } = paths(args, io);
  const config = loadConfig(configPath, io);
  if (!config) return 1;
  const generated = generate(config, catalog);
  for (const w of generated.warnings) io.err(`! ${w}`);
  io.out(
    `${configPath} is valid: ${generated.agents.length + 1} agents (PM + ${generated.agents.length}).`,
  );
  return 0;
}

async function cmdApply(args: Args, io: Io, catalog: Catalog): Promise<number> {
  const { projectDir, configPath } = paths(args, io);
  refuseAgentTeamFolder(projectDir);
  const config = loadConfig(configPath, io);
  if (!config) return 1;
  const plan = planApply(projectDir, generate(config, catalog));
  const pending = pendingChanges(plan);

  io.out(`Plan for ${projectDir}:\n${summarisePlan(plan)}`);
  if (args.values.diff || args.values["dry-run"]) {
    for (const c of pending) io.out(diffChange(c));
  }
  if (!pending.length || args.values["dry-run"]) return 0;

  if (!args.values.yes) {
    if (!io.isTTY) {
      io.err("Not running in a terminal, so nothing was written. Re-run with --yes to apply.");
      return 1;
    }
    if (!(await io.confirm(`Write ${pending.length} change(s)?`))) {
      io.out("Nothing written.");
      return 1;
    }
  }
  applyPlan(plan);
  io.out(`Done. Run \`claude\` in ${projectDir} and type /team <goal>.`);
  return 0;
}

async function cmdProfile(args: Args, io: Io, catalog: Catalog): Promise<number> {
  const [, sub, name] = args.positionals;
  switch (sub) {
    case "list":
    case undefined: {
      for (const p of listProfiles(catalog)) {
        io.out(`${p.name.padEnd(20)} ${p.source.padEnd(9)} ${p.description ?? ""}`.trimEnd());
      }
      return 0;
    }
    case "show": {
      if (!name) throw new UsageError("Usage: agent-team profile show <name>");
      io.out(JSON.stringify(loadProfile(name, catalog), null, 2));
      return 0;
    }
    case "save": {
      if (!name) throw new UsageError("Usage: agent-team profile save <name>");
      const config = loadConfig(paths(args, io).configPath, io);
      if (!config) return 1;
      const file = saveProfile(profileFromTeamConfig(config, name, args.values.description), {
        overwrite: args.values.force ?? false,
      });
      io.out(`Saved profile "${name}" to ${file}.`);
      return 0;
    }
    case "delete": {
      if (!name) throw new UsageError("Usage: agent-team profile delete <name>");
      deleteProfile(name);
      io.out(`Deleted profile "${name}".`);
      return 0;
    }
    default:
      throw new UsageError(`Unknown profile command "${sub}". Use list, show, save or delete.`);
  }
}

async function cmdUi(args: Args, io: Io, catalog: Catalog): Promise<number> {
  const start = initialProject({
    cwd: io.cwd,
    ...(args.values.dir ? { dir: args.values.dir } : {}),
    ...(args.values["projects-root"] ? { root: args.values["projects-root"] } : {}),
  });
  const projectDir = start.projectDir;
  const configPath = projectDir
    ? resolve(projectDir, args.values.config ?? CONFIG_FILE)
    : undefined;
  const host = args.values.host ?? "127.0.0.1";
  const port = Number(args.values.port ?? DEFAULT_UI_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new UsageError(`Not a valid port: ${args.values.port}`);

  const ui = await startUiServer({
    projectDir,
    ...(configPath ? { configPath } : {}),
    projectsRoot: start.root,
    ...(start.problem ? { startProblem: start.problem } : {}),
    catalog,
    host,
    port,
    version: version(),
  });
  io.out(
    projectDir
      ? `agent-team UI for ${projectDir}\n\n  Open: ${ui.url}\n`
      : `agent-team UI: choose the team's project in the browser (projects folder: ${start.root})\n\n  Open: ${ui.url}\n`,
  );
  if (!isLoopback(host)) {
    io.err(
      "! Listening beyond this machine. Anyone on the network who gets the link (it holds the access token) can change this project's agent files.",
    );
  }
  io.out("Press Ctrl+C to stop.");
  await new Promise<void>((done) => {
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      void ui.close().then(done);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
  return 0;
}

/** Swapped out in tests. */
export const runDeps: { sdk: () => Promise<Sdk>; env: () => Record<string, string | undefined> } = {
  sdk: loadSdk,
  env: () => process.env,
};

function formatEvent(e: RunEvent): string | null {
  const money = (n: number) => `$${n.toFixed(2)}`;
  switch (e.kind) {
    case "start":
      return `Team: ${e.agents.length ? `pm + ${e.agents.join(", ")}` : "pm"}${e.layered ? " (layered)" : ""}${e.maxBudgetUsd ? ` · budget ${money(e.maxBudgetUsd)}` : ""}`;
    case "text":
      return `\n[${e.agent}] ${e.text}`;
    case "tool":
      return `[${e.agent}] → ${e.tool}: ${e.summary}`;
    case "delegate":
      return `\n[pm] ⇒ lead-dev team: ${e.task}`;
    case "delegate-done":
      return `[lead-dev] team finished (${e.ok ? "ok" : "stopped"}, ${money(e.costUsd)}, ${e.turns} turns)`;
    case "denied":
      return `[${e.agent}] ✗ not allowed: ${e.tool} ${e.reason}`;
    case "error":
      return `Error: ${e.message}`;
    default:
      return null;
  }
}

async function cmdRun(args: Args, io: Io, catalog: Catalog): Promise<number> {
  const { projectDir, configPath } = paths(args, io);
  refuseAgentTeamFolder(projectDir);
  const config = loadConfig(configPath, io);
  if (!config) return 1;
  const goal = args.positionals.slice(1).join(" ").trim();
  const workspaceDir = join(projectDir, config.workflow.workspace);

  let resume = args.values.resume;
  if (args.values.continue) {
    resume = listRuns(workspaceDir).find((r) => r.sessionId)?.sessionId;
    if (!resume) {
      io.err("There's no earlier run to continue.");
      return 1;
    }
  }
  if (!goal)
    throw new UsageError(
      resume
        ? 'Say what to tell the team, e.g. agent-team run --continue "Approved"'
        : 'Usage: agent-team run "<goal>"',
    );
  const budget = args.values.budget === undefined ? undefined : Number(args.values.budget);
  if (budget !== undefined && !(budget > 0))
    throw new UsageError(`Not a valid budget: ${args.values.budget}`);
  if (args.values.layered && args.values.flat)
    throw new UsageError("Choose --layered or --flat, not both.");
  const layered = args.values.layered ? true : args.values.flat ? false : undefined;

  const abortController = new AbortController();
  const stop = () => abortController.abort();
  process.once("SIGINT", stop);
  try {
    const outcome = await runTeam({
      projectDir,
      config,
      catalog,
      goal,
      ...(resume ? { resume } : {}),
      ...(layered === undefined ? {} : { layered }),
      ...(budget === undefined ? {} : { maxBudgetUsd: budget }),
      approveAll: args.values.yes ?? false,
      env: runDeps.env(),
      ask: (q) => (io.isTTY ? io.confirm(q) : Promise.resolve(false)),
      onEvent: (e) => {
        const line = formatEvent(e);
        if (line) io.out(line);
      },
      sdk: await runDeps.sdk(),
      abortController,
    });
    const r = outcome.result;
    if (r) {
      io.out(
        `\n${r.ok ? "Finished" : `Stopped (${r.subtype})`}: $${(r.costUsd + r.teamCostUsd).toFixed(2)}${r.teamCostUsd ? ` (PM $${r.costUsd.toFixed(2)} + team $${r.teamCostUsd.toFixed(2)})` : ""}, ${r.turns} turns.`,
      );
      if (r.text) io.out(`\n${r.text}`);
    }
    io.out(
      `\nLog: ${relative(projectDir, outcome.log.file)}\nReply or carry on with: agent-team run --continue "<message>"`,
    );
    return outcome.ok ? 0 : 1;
  } catch (err) {
    if (err instanceof RunError || err instanceof MissingEnvError) {
      io.err(err.message);
      return 1;
    }
    throw err;
  } finally {
    process.off("SIGINT", stop);
  }
}

async function cmdRuns(args: Args, io: Io): Promise<number> {
  const { projectDir, configPath } = paths(args, io);
  const config = loadConfig(configPath, io);
  if (!config) return 1;
  const runs = listRuns(join(projectDir, config.workflow.workspace));
  if (!runs.length) io.out('No runs yet. Start one with agent-team run "<goal>".');
  for (const r of runs) {
    const cost = r.costUsd === undefined ? "" : `$${r.costUsd.toFixed(2)}`;
    io.out(`${r.id}  ${r.status.padEnd(8)} ${cost.padStart(7)}  ${r.goal}`);
  }
  return 0;
}

/** Swapped out in tests. */
export const doctorDeps: { get: () => DoctorDeps } = { get: defaultDeps };

async function cmdDoctor(args: Args, io: Io, catalog: Catalog): Promise<number> {
  const { projectDir, configPath } = paths(args, io);
  const checks = runDoctor(projectDir, configPath, catalog, doctorDeps.get());
  io.out(formatChecks(checks));
  const errors = checks.filter((c) => c.level === "error").length;
  const warnings = checks.filter((c) => c.level === "warn").length;
  io.out(
    errors
      ? `\n${errors} problem(s) to fix.`
      : warnings
        ? `\nReady, with ${warnings} warning(s).`
        : "\nReady. Run `claude` here and type /team <goal>.",
  );
  return errors ? 1 : 0;
}

/** Swapped out in tests. */
export const sessionCli: {
  deps: () => SessionDeps;
  sleep: (ms: number) => Promise<void>;
  script: () => string;
} = {
  deps: defaultSessionDeps,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  script: () => fileURLToPath(import.meta.url),
};

function describeSession(s: SessionStatus, projectDir: string): string {
  if (!s.running) return `No team session is running for ${projectDir}.`;
  if (s.waitingFor === "trust") {
    return `Claude Code is asking whether you trust ${projectDir} before it starts.\nIf you do, run: agent-team session trust -C ${projectDir}`;
  }
  if (s.url) return `The team is running. Follow it in the Claude app or at:\n  ${s.url}`;
  return `The team's session is starting (tmux session ${s.tmuxSession}); the Remote Control link isn't showing yet.`;
}

/** Poll until the session shows its link or a question, or the time runs out. */
async function settle(
  projectDir: string,
  deps: SessionDeps,
  seconds: number,
): Promise<SessionStatus> {
  let status = sessionStatus(projectDir, deps);
  for (
    let waited = 0;
    waited < seconds * 1000 && status.running && !status.url && !status.waitingFor;
    waited += 1000
  ) {
    await sessionCli.sleep(1000);
    status = sessionStatus(projectDir, deps);
  }
  return status;
}

async function cmdStart(args: Args, io: Io, catalog: Catalog): Promise<number> {
  const { projectDir, configPath } = paths(args, io);
  refuseAgentTeamFolder(projectDir);
  const goal = args.positionals.slice(1).join(" ").trim();
  if (!goal) throw new UsageError('Usage: agent-team start "<goal>" [-C <project>]');
  const mode = args.values["permission-mode"];
  if (mode && !SESSION_PERMISSION_MODES.includes(mode as SessionPermissionMode)) {
    throw new UsageError(`--permission-mode must be one of ${SESSION_PERMISSION_MODES.join(", ")}`);
  }
  const wait = Number(args.values.wait ?? 30);
  if (!(wait >= 0)) throw new UsageError(`Not a valid --wait: ${args.values.wait}`);

  const config = loadConfig(configPath, io);
  if (!config) return 1;
  const plan = planApply(projectDir, generate(config, catalog));
  const pending = pendingChanges(plan);
  if (pending.length) {
    applyPlan(plan);
    io.out(
      `Applied the team's files (${pending.length} change${pending.length === 1 ? "" : "s"}).`,
    );
  }
  const deps = sessionCli.deps();
  startSession(
    {
      projectDir,
      goal,
      name: args.values.name ?? `${config.project.name} team`,
      ...(mode ? { permissionMode: mode as SessionPermissionMode } : {}),
    },
    deps,
  );
  io.out(describeSession(await settle(projectDir, deps, wait), projectDir));
  return 0;
}

async function cmdSession(args: Args, io: Io): Promise<number> {
  const { projectDir } = paths(args, io);
  const deps = sessionCli.deps();
  const sub = args.positionals[1] ?? "status";
  if (sub === "status") io.out(describeSession(sessionStatus(projectDir, deps), projectDir));
  else if (sub === "trust") {
    trustFolder(projectDir, deps);
    io.out(
      describeSession(await settle(projectDir, deps, Number(args.values.wait ?? 30)), projectDir),
    );
  } else if (sub === "stop") {
    const was = sessionStatus(projectDir, deps).running;
    stopSession(projectDir, deps);
    io.out(was ? "Stopped the team's session." : `No team session is running for ${projectDir}.`);
  } else throw new UsageError(`Unknown session command "${sub}". Use status, trust or stop.`);
  return 0;
}

async function cmdProjects(args: Args, io: Io): Promise<number> {
  const root = resolve(io.cwd, args.values.dir ?? ".");
  const deps = sessionCli.deps();
  const teams = listProjects(root).filter((p) => p.hasTeam);
  if (!teams.length) {
    io.out(`No projects with a team in ${root}. Create one with agent-team ui or agent-team init.`);
    return 0;
  }
  for (const p of teams) {
    const s = sessionStatus(p.dir, deps);
    const note = s.running ? (s.url ? `session running: ${s.url}` : "session starting") : "";
    io.out(`${p.name.padEnd(28)} ${p.dir}${note ? `  (${note})` : ""}`);
  }
  return 0;
}

async function cmdInstallCommand(args: Args, io: Io, catalog: Catalog): Promise<number> {
  if (args.values.uninstall) {
    const removed = uninstallUserCommand();
    io.out(removed ? `Removed ${removed}.` : "The /team command isn't installed.");
    return 0;
  }
  const { path, replaced } = installUserCommand(catalog, cliInvocation(sessionCli.script()), {
    force: args.values.force ?? false,
  });
  io.out(`${replaced ? "Updated" : "Installed"} ${path}.`);
  io.out(
    "In a Claude Code session started in a folder of projects, type /team <project> <goal> to start that project's team with Remote Control. Inside a project with a team, /team runs the team there.",
  );
  return 0;
}

const COMMANDS: Record<string, (args: Args, io: Io, catalog: Catalog) => Promise<number>> = {
  start: cmdStart,
  session: cmdSession,
  projects: cmdProjects,
  "install-command": cmdInstallCommand,
  ui: cmdUi,
  doctor: cmdDoctor,
  run: cmdRun,
  runs: cmdRuns,
  init: cmdInit,
  validate: cmdValidate,
  apply: cmdApply,
  profile: cmdProfile,
};

export async function main(argv: string[], io: Io, catalog?: Catalog): Promise<number> {
  try {
    const args = parse(argv);
    if (args.values.version) {
      io.out(version());
      return 0;
    }
    const command = args.positionals[0];
    if (args.values.help || !command || command === "help") {
      io.out(HELP);
      return 0;
    }
    const run = COMMANDS[command];
    if (!run) throw new UsageError(`Unknown command "${command}". Run \`agent-team --help\`.`);
    return await run(args, io, catalog ?? loadCatalog());
  } catch (err) {
    if (err instanceof SessionError || err instanceof CommandError) {
      io.err(err.message);
      return 1;
    }
    if (err instanceof ProjectError) {
      io.err(err.message);
      return 1;
    }
    if (
      err instanceof UsageError ||
      (err as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")
    ) {
      io.err((err as Error).message);
      return 2;
    }
    io.err(`Error: ${(err as Error).message}`);
    return 1;
  }
}

function isEntryPoint(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  const io: Io = {
    out: (t) => process.stdout.write(`${t}\n`),
    err: (t) => process.stderr.write(`${t}\n`),
    confirm: async (q) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question(`${q} [y/N] `);
      rl.close();
      return /^y(es)?$/i.test(answer.trim());
    },
    cwd: process.cwd(),
    isTTY: Boolean(process.stdin.isTTY),
  };
  process.exitCode = await main(process.argv.slice(2), io);
}
