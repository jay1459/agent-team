import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { createTwoFilesPatch } from "diff";
import { GENERATED_MARKER, PATHS, type Generated } from "./generate.js";

export const SECTION_START = "<!-- agent-team:start -->";
export const SECTION_END = "<!-- agent-team:end -->";

export type ChangeKind = "create" | "update" | "delete" | "unchanged";

export type Change = {
  path: string;
  kind: ChangeKind;
  before: string | null;
  after: string | null;
  /** Why this file is in the plan, for the summary. */
  what: string;
};

export type Plan = {
  projectDir: string;
  changes: Change[];
  warnings: string[];
};

type Manifest = { generator: "agent-team"; version: 1; files: string[]; mcpServers: string[] };

export class PlanError extends Error {}

function safePath(projectDir: string, path: string): string {
  const full = resolve(projectDir, path);
  const rel = relative(resolve(projectDir), full);
  if (rel === "" || rel.startsWith("..") || rel.startsWith(sep)) {
    throw new PlanError(`Refusing to write outside the project: ${path}`);
  }
  return full;
}

function readIfExists(projectDir: string, path: string): string | null {
  const full = safePath(projectDir, path);
  return existsSync(full) ? readFileSync(full, "utf8") : null;
}

function readManifest(projectDir: string): Manifest | null {
  const text = readIfExists(projectDir, PATHS.manifest);
  if (text === null) return null;
  try {
    const m = JSON.parse(text) as Partial<Manifest>;
    return {
      generator: "agent-team",
      version: 1,
      files: m.files ?? [],
      mcpServers: m.mcpServers ?? [],
    };
  } catch {
    throw new PlanError(
      `${PATHS.manifest} isn't valid JSON. Fix or delete it and run apply again.`,
    );
  }
}

/** Put the generated section into CLAUDE.md, keeping everything outside the markers. */
export function mergeClaudeMd(existing: string | null, section: string): string {
  const block = `${SECTION_START}\n${section.trim()}\n${SECTION_END}`;
  if (existing === null || existing.trim() === "") return `${block}\n`;

  const starts = existing.split(SECTION_START).length - 1;
  const ends = existing.split(SECTION_END).length - 1;
  if (starts === 0 && ends === 0) return `${existing.trimEnd()}\n\n${block}\n`;

  const start = existing.indexOf(SECTION_START);
  const end = existing.indexOf(SECTION_END);
  if (starts !== 1 || ends !== 1 || end < start) {
    throw new PlanError(
      `CLAUDE.md has broken agent-team markers. Keep exactly one "${SECTION_START}" followed by one "${SECTION_END}", or remove both.`,
    );
  }
  return existing.slice(0, start) + block + existing.slice(end + SECTION_END.length);
}

function mergeMcpJson(
  existing: string | null,
  managed: Generated["mcpServers"],
  previouslyManaged: string[],
): { content: string | null; warnings: string[] } {
  const warnings: string[] = [];
  let doc: { mcpServers?: Record<string, unknown> } & Record<string, unknown> = {};
  if (existing !== null) {
    try {
      doc = JSON.parse(existing) as typeof doc;
    } catch {
      throw new PlanError(`${PATHS.mcpJson} isn't valid JSON. Fix it and run apply again.`);
    }
  }
  const servers: Record<string, unknown> = { ...(doc.mcpServers ?? {}) };
  for (const name of previouslyManaged) delete servers[name];
  for (const [name, server] of Object.entries(managed)) {
    if (name in servers) {
      warnings.push(
        `${PATHS.mcpJson} already has a server called "${name}"; agent-team now manages it.`,
      );
    }
    servers[name] = server;
  }
  if (existing === null && Object.keys(managed).length === 0) return { content: null, warnings };
  return { content: `${JSON.stringify({ ...doc, mcpServers: servers }, null, 2)}\n`, warnings };
}

function change(path: string, before: string | null, after: string | null, what: string): Change {
  let kind: ChangeKind;
  if (after === null) kind = before === null ? "unchanged" : "delete";
  else if (before === null) kind = "create";
  else kind = before === after ? "unchanged" : "update";
  return { path, kind, before, after, what };
}

/** Work out what `apply` would do, without touching the disk. */
export function planApply(projectDir: string, generated: Generated): Plan {
  const warnings = [...generated.warnings];
  const changes: Change[] = [];
  const manifest = readManifest(projectDir);
  const owned = new Set(generated.files.map((f) => f.path));

  for (const file of generated.files) {
    const what = file.path === PATHS.command ? "/team command" : "agent";
    changes.push(change(file.path, readIfExists(projectDir, file.path), file.content, what));
  }

  // Files from an earlier apply that the team no longer needs.
  for (const path of manifest?.files ?? []) {
    if (owned.has(path)) continue;
    const before = readIfExists(projectDir, path);
    if (before === null) continue;
    if (before.includes(GENERATED_MARKER)) {
      changes.push(change(path, before, null, "no longer on the team"));
    } else {
      warnings.push(
        `${path} is no longer generated but was edited by hand, so it was left in place.`,
      );
    }
  }

  const claudeBefore = readIfExists(projectDir, PATHS.claudeMd);
  changes.push(
    change(
      PATHS.claudeMd,
      claudeBefore,
      mergeClaudeMd(claudeBefore, generated.claudeSection),
      "PM instructions",
    ),
  );

  const mcpBefore = readIfExists(projectDir, PATHS.mcpJson);
  const mcp = mergeMcpJson(mcpBefore, generated.mcpServers, manifest?.mcpServers ?? []);
  warnings.push(...mcp.warnings);
  if (mcp.content !== null)
    changes.push(change(PATHS.mcpJson, mcpBefore, mcp.content, "MCP servers"));

  for (const file of generated.workspace) {
    if (readIfExists(projectDir, file.path) === null) {
      changes.push(change(file.path, null, file.content, "shared workspace"));
    }
  }

  const newManifest: Manifest = {
    generator: "agent-team",
    version: 1,
    files: [...owned].sort(),
    mcpServers: Object.keys(generated.mcpServers).sort(),
  };
  changes.push(
    change(
      PATHS.manifest,
      readIfExists(projectDir, PATHS.manifest),
      `${JSON.stringify(newManifest, null, 2)}\n`,
      "list of generated files",
    ),
  );

  return { projectDir, changes, warnings };
}

export function pendingChanges(plan: Plan): Change[] {
  return plan.changes.filter((c) => c.kind !== "unchanged");
}

export function applyPlan(plan: Plan): void {
  for (const c of pendingChanges(plan)) {
    const full = safePath(plan.projectDir, c.path);
    if (c.after === null) {
      rmSync(full, { force: true });
    } else {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, c.after);
    }
  }
}

export function diffChange(c: Change): string {
  return createTwoFilesPatch(
    c.before === null ? "/dev/null" : `a/${c.path}`,
    c.after === null ? "/dev/null" : `b/${c.path}`,
    c.before ?? "",
    c.after ?? "",
    undefined,
    undefined,
    { context: 3 },
  );
}

export function summarisePlan(plan: Plan): string {
  const pending = pendingChanges(plan);
  const symbol: Record<ChangeKind, string> = {
    create: "+",
    update: "~",
    delete: "-",
    unchanged: "=",
  };
  const lines = pending.map((c) => `  ${symbol[c.kind]} ${c.path}  (${c.what})`);
  const unchanged = plan.changes.length - pending.length;
  if (!pending.length) lines.push("  Everything is up to date.");
  else if (unchanged) lines.push(`  ${unchanged} file(s) unchanged`);
  for (const w of plan.warnings) lines.push(`  ! ${w}`);
  return lines.join("\n");
}
