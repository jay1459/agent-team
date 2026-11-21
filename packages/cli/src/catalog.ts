import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseProfile,
  parseRoleDefinition,
  parseSpecialistDefinition,
  type Profile,
  type RoleDefinition,
  type RoleId,
  type SpecialistDefinition,
} from "@agent-team/schema";
import { parse as parseYaml } from "yaml";

export type Templates = {
  claudeSection: string;
  teamCommand: string;
  specialist: string;
};

export type Catalog = {
  dir: string;
  roles: Map<RoleId, RoleDefinition>;
  specialists: Map<string, SpecialistDefinition>;
  profiles: Map<string, Profile>;
  templates: Templates;
};

export class CatalogError extends Error {}

/**
 * The catalog ships next to dist/ in the npm package and at the repo root during development.
 */
export function defaultCatalogDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "../catalog"), join(here, "../../../catalog")];
  const found = candidates.find((dir) => existsSync(join(dir, "roles")));
  if (!found) throw new CatalogError(`Can't find the catalog (looked in ${candidates.join(", ")})`);
  return found;
}

/** Split a markdown file with YAML frontmatter into its fields plus a `prompt` (the body). */
export function readFrontmatterFile(file: string): Record<string, unknown> {
  const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) throw new CatalogError(`${file}: missing frontmatter`);
  const fields: unknown = parseYaml(match[1]!);
  if (typeof fields !== "object" || fields === null) {
    throw new CatalogError(`${file}: frontmatter must be a YAML mapping`);
  }
  return { ...fields, prompt: match[2]!.trim() };
}

function listFiles(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .sort()
    .map((f) => join(dir, f));
}

function loadEntries<T extends { id: string } | { name: string }>(
  files: string[],
  read: (file: string) => unknown,
  parse: (input: unknown) => { ok: true; value: T } | { ok: false; errors: string[] },
  ext: string,
): Map<string, T> {
  const out = new Map<string, T>();
  for (const file of files) {
    const result = parse(read(file));
    if (!result.ok) throw new CatalogError(`${file}:\n  ${result.errors.join("\n  ")}`);
    const key = "id" in result.value ? result.value.id : result.value.name;
    if (key !== basename(file, ext)) {
      throw new CatalogError(`${file}: "${key}" doesn't match the file name`);
    }
    out.set(key, result.value);
  }
  return out;
}

export function loadCatalog(dir = defaultCatalogDir()): Catalog {
  const readJson = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));
  const template = (name: string) => readFileSync(join(dir, "templates", name), "utf8").trim();
  return {
    dir,
    roles: loadEntries(
      listFiles(join(dir, "roles"), ".md"),
      readFrontmatterFile,
      parseRoleDefinition,
      ".md",
    ) as Map<RoleId, RoleDefinition>,
    specialists: loadEntries(
      listFiles(join(dir, "specialists"), ".md"),
      readFrontmatterFile,
      parseSpecialistDefinition,
      ".md",
    ),
    profiles: loadEntries(
      listFiles(join(dir, "profiles"), ".json"),
      readJson,
      parseProfile,
      ".json",
    ),
    templates: {
      claudeSection: template("claude-section.md"),
      teamCommand: template("team-command.md"),
      specialist: template("specialist.md"),
    },
  };
}
