// Checks the files shipped in the repo (catalog, examples, generated JSON Schemas) against the schema.
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  jsonSchemas,
  parseProfile,
  parseRoleDefinition,
  parseSpecialistDefinition,
  parseTeamConfig,
  ROLE_IDS,
} from "../src/index.js";

const root = join(import.meta.dirname, "../../..");
const KNOWN_PLACEHOLDERS = new Set(["project", "workspace", "approvalGates"]);

function readRoleFile(file: string) {
  const text = readFileSync(file, "utf8");
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) throw new Error(`${file}: missing frontmatter`);
  return { ...parseYaml(match[1]!), prompt: match[2]!.trim() };
}

describe("role catalog", () => {
  const dir = join(root, "catalog/roles");
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));

  it("has exactly one entry per role", () => {
    expect(files.map((f) => basename(f, ".md")).sort()).toEqual([...ROLE_IDS].sort());
  });

  for (const file of files) {
    it(`${file} is valid`, () => {
      const role = readRoleFile(join(dir, file));
      const result = parseRoleDefinition(role);
      expect(result.ok ? [] : result.errors).toEqual([]);
      expect(role.id).toBe(basename(file, ".md"));

      const placeholders = [...role.prompt.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
      for (const p of placeholders) expect(KNOWN_PLACEHOLDERS, `{{${p}}}`).toContain(p);
    });
  }
});

describe("specialist catalog", () => {
  const dir = join(root, "catalog/specialists");
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  if (!files.length) it.todo("has specialists");
  for (const file of files) {
    it(`${file} is valid`, () => {
      const spec = readRoleFile(join(dir, file));
      const result = parseSpecialistDefinition(spec);
      expect(result.ok ? [] : result.errors).toEqual([]);
      expect(spec.id).toBe(basename(file, ".md"));
      const placeholders = [...spec.prompt.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
      for (const p of placeholders) expect(KNOWN_PLACEHOLDERS, `{{${p}}}`).toContain(p);
    });
  }
});

describe("built-in profiles", () => {
  const dir = join(root, "catalog/profiles");
  for (const file of readdirSync(dir)) {
    it(`${file} is valid`, () => {
      const result = parseProfile(JSON.parse(readFileSync(join(dir, file), "utf8")));
      expect(result.ok ? [] : result.errors).toEqual([]);
      if (result.ok) expect(result.value.name).toBe(basename(file, ".json"));
    });
  }
});

describe("examples", () => {
  const dir = join(root, "examples");
  for (const name of readdirSync(dir)) {
    it(`${name}/team.json is valid`, () => {
      const result = parseTeamConfig(
        JSON.parse(readFileSync(join(dir, name, "team.json"), "utf8")),
      );
      expect(result.ok ? [] : result.errors).toEqual([]);
    });
  }
});

describe("generated JSON Schemas", () => {
  it("are up to date (run `npm run schemas` if this fails)", () => {
    for (const [name, schema] of Object.entries(jsonSchemas())) {
      const committed = JSON.parse(
        readFileSync(join(root, "schemas", `${name}.schema.json`), "utf8"),
      );
      expect(committed).toEqual(JSON.parse(JSON.stringify(schema)));
    }
  });
});
