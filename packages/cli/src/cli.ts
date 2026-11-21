#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { profileFromTeamConfig, teamConfigFromProfile, type TeamConfig } from "@agent-team/schema";
import { loadCatalog, type Catalog } from "./catalog.js";
import { CONFIG_FILE, readConfigFile, writeConfigFile } from "./config-file.js";
import { generate } from "./generate.js";
import { applyPlan, diffChange, pendingChanges, planApply, summarisePlan } from "./plan.js";
import { deleteProfile, listProfiles, loadProfile, saveProfile } from "./profiles.js";

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
  agent-team validate         Check team.json
  agent-team apply [--yes] [--dry-run] [--diff]
                              Write the agent files Claude Code reads
  agent-team profile list     List built-in and saved profiles
  agent-team profile show <name>
  agent-team profile save <name> [--description <text>] [--force]
                              Save this project's team as a reusable profile
  agent-team profile delete <name>

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
      description: { type: "string" },
      force: { type: "boolean", short: "f" },
      yes: { type: "boolean", short: "y" },
      "dry-run": { type: "boolean" },
      diff: { type: "boolean" },
      host: { type: "string" },
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

async function cmdInit(args: Args, io: Io, catalog: Catalog): Promise<number> {
  const { projectDir, configPath } = paths(args, io);
  if (readConfigFile(configPath).exists && !args.values.force) {
    io.err(`${configPath} already exists (use --force to replace it).`);
    return 1;
  }
  const project = { name: args.values.name ?? basename(projectDir) };
  const config = args.values.profile
    ? teamConfigFromProfile(loadProfile(args.values.profile, catalog), project)
    : teamConfigFromProfile(loadProfile("minimal", catalog), project);
  if (!args.values.profile) delete config.extends;
  writeConfigFile(configPath, config);
  io.out(
    `Created ${configPath}${args.values.profile ? ` from profile "${args.values.profile}"` : ""}.`,
  );
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

const COMMANDS: Record<string, (args: Args, io: Io, catalog: Catalog) => Promise<number>> = {
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
