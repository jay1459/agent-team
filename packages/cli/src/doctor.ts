import { spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import type { Catalog } from "./catalog.js";
import { readConfigFile } from "./config-file.js";
import { generate, GenerateError } from "./generate.js";
import { pendingChanges, planApply, PlanError } from "./plan.js";

export type CheckLevel = "ok" | "info" | "warn" | "error";
export type Check = { level: CheckLevel; title: string; detail?: string };

export type DoctorDeps = {
  env: Record<string, string | undefined>;
  nodeVersion: string;
  /** Full path of a command on PATH, or null. */
  which: (command: string) => string | null;
  /** `claude --version` output, or null if Claude Code isn't installed. */
  claudeVersion: () => string | null;
};

const MIN_NODE = [22, 12] as const;

export function defaultDeps(): DoctorDeps {
  const env = process.env;
  return {
    env,
    nodeVersion: process.versions.node,
    which: (command) => findOnPath(command, env),
    claudeVersion: () => {
      const r = spawnSync("claude", ["--version"], { encoding: "utf8", timeout: 15_000 });
      return r.status === 0 ? r.stdout.trim() : null;
    },
  };
}

export function findOnPath(
  command: string,
  env: Record<string, string | undefined>,
): string | null {
  const candidates = isAbsolute(command)
    ? [command]
    : (env.PATH ?? "")
        .split(delimiter)
        .filter(Boolean)
        .flatMap((dir) => {
          const exts =
            process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
          return exts.map((ext) => join(dir, command + ext));
        });
  for (const file of candidates) {
    try {
      accessSync(file, constants.X_OK);
      return file;
    } catch {
      // keep looking
    }
  }
  return null;
}

function nodeOk(version: string): boolean {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
}

/** Check that a project is ready for `claude` + `/team`. Never changes anything. */
export function runDoctor(
  projectDir: string,
  configPath: string,
  catalog: Catalog,
  deps: DoctorDeps,
): Check[] {
  const checks: Check[] = [];
  const add = (level: CheckLevel, title: string, detail?: string) =>
    checks.push(detail ? { level, title, detail } : { level, title });
  const isSet = (name: string) => Boolean(deps.env[name]);

  add(
    nodeOk(deps.nodeVersion) ? "ok" : "error",
    `Node.js ${deps.nodeVersion}`,
    nodeOk(deps.nodeVersion)
      ? undefined
      : `agent-team needs Node.js ${MIN_NODE.join(".")} or later.`,
  );

  const claude = deps.claudeVersion();
  if (claude) add("ok", `Claude Code ${claude.replace(/\s*\(Claude Code\)\s*$/, "")}`);
  else
    add(
      "warn",
      "Claude Code not found",
      "Install it from https://code.claude.com, then run `claude` in this project.",
    );

  const file = readConfigFile(configPath);
  if (!file.exists) {
    add("error", "No team.json", "Run `agent-team init` or `agent-team ui` to create one.");
    return checks;
  }
  if (!file.result.ok) {
    add("error", "team.json has problems", file.result.errors.join("\n"));
    return checks;
  }
  const config = file.result.value;

  let generated;
  try {
    generated = generate(config, catalog);
  } catch (err) {
    if (err instanceof GenerateError) {
      add("error", "The team can't be generated", err.message);
      return checks;
    }
    throw err;
  }
  add(
    "ok",
    `team.json is valid: PM + ${generated.agents.length} agent${generated.agents.length === 1 ? "" : "s"}`,
  );
  for (const w of generated.warnings) add("warn", w);

  try {
    const pending = pendingChanges(planApply(projectDir, generated));
    if (pending.length) {
      add(
        "warn",
        `${pending.length} generated file${pending.length === 1 ? " is" : "s are"} out of date`,
        `Run \`agent-team apply\`. Changed: ${pending.map((c) => c.path).join(", ")}`,
      );
    } else add("ok", "Generated files are up to date");
  } catch (err) {
    if (err instanceof PlanError) add("error", "Can't check the generated files", err.message);
    else throw err;
  }

  // MCP servers: each one once, however many specialists share it.
  const seen = new Set<string>();
  for (const use of generated.mcp) {
    if (seen.has(use.name)) continue;
    seen.add(use.name);
    const label = `MCP server "${use.name}"`;
    const problems: string[] = [];
    let level: CheckLevel = "ok";
    if (use.server.type !== "http" && !deps.which(use.server.command)) {
      level = "error";
      problems.push(`\`${use.server.command}\` isn't on PATH.`);
    }
    const missing = use.requires.filter((v) => !isSet(v));
    if (missing.length) {
      if (level === "ok") level = "warn";
      problems.push(`Set ${missing.join(", ")} before starting claude.`);
    }
    const where =
      use.server.type === "http"
        ? use.server.url
        : `${use.server.command} ${use.server.args.join(" ")}`;
    add(level, label, [where, ...problems, ...(use.note ? [use.note] : [])].join("\n"));
  }
  if (seen.size) {
    add(
      "info",
      "Approve the MCP servers in Claude Code",
      "Claude Code asks before using a project's .mcp.json servers. Approve them when asked, or check with /mcp.",
    );
  }

  const unsetSecrets = Object.entries(config.secrets)
    .map(([name, ref]) => [name, ref.slice("env:".length)] as const)
    .filter(([, v]) => !isSet(v));
  if (unsetSecrets.length) {
    add("warn", "Secrets not set", unsetSecrets.map(([n, v]) => `${n}: ${v} isn't set`).join("\n"));
  } else if (Object.keys(config.secrets).length) {
    add("ok", "All secrets are set");
  }

  return checks;
}

export function formatChecks(checks: Check[]): string {
  const icon: Record<CheckLevel, string> = { ok: "✓", info: "i", warn: "!", error: "✗" };
  return checks
    .map((c) => {
      const head = `${icon[c.level]} ${c.title}`;
      return c.detail ? `${head}\n${c.detail.replace(/^/gm, "    ")}` : head;
    })
    .join("\n");
}
