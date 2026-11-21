import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { JSON_SCHEMA_IDS, parseProfile, type Profile } from "@agent-team/schema";
import type { Catalog } from "./catalog.js";

export type ProfileInfo = { name: string; description?: string; source: "user" | "built-in" };

export class ProfileError extends Error {}

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** ~/.agent-team, or $AGENT_TEAM_HOME (used by tests). */
export function agentTeamHome(): string {
  return process.env.AGENT_TEAM_HOME ?? join(homedir(), ".agent-team");
}

export function userProfilesDir(): string {
  return join(agentTeamHome(), "profiles");
}

function checkName(name: string) {
  if (!NAME.test(name)) {
    throw new ProfileError(
      `"${name}" isn't a valid profile name: use lower-case letters, digits and hyphens`,
    );
  }
}

function readUserProfile(name: string): Profile | null {
  const file = join(userProfilesDir(), `${name}.json`);
  if (!existsSync(file)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new ProfileError(`${file} isn't valid JSON`);
  }
  const result = parseProfile(raw);
  if (!result.ok) throw new ProfileError(`${file}:\n  ${result.errors.join("\n  ")}`);
  return result.value;
}

/** User profiles shadow built-in ones with the same name. */
export function listProfiles(catalog: Catalog): ProfileInfo[] {
  const out = new Map<string, ProfileInfo>();
  for (const p of catalog.profiles.values()) {
    out.set(p.name, { name: p.name, description: p.description, source: "built-in" });
  }
  const dir = userProfilesDir();
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const name = f.slice(0, -".json".length);
      if (!NAME.test(name)) continue;
      const p = readUserProfile(name);
      if (p) out.set(name, { name, description: p.description, source: "user" });
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function loadProfile(name: string, catalog: Catalog): Profile {
  checkName(name);
  const p = readUserProfile(name) ?? catalog.profiles.get(name);
  if (!p) {
    const names = listProfiles(catalog)
      .map((p) => p.name)
      .join(", ");
    throw new ProfileError(`No profile called "${name}" (available: ${names})`);
  }
  return structuredClone(p);
}

export function saveProfile(profile: Profile, opts: { overwrite?: boolean } = {}): string {
  checkName(profile.name);
  const result = parseProfile(profile);
  if (!result.ok) throw new ProfileError(result.errors.join("\n"));
  const dir = userProfilesDir();
  const file = join(dir, `${profile.name}.json`);
  if (existsSync(file) && !opts.overwrite) {
    throw new ProfileError(`Profile "${profile.name}" already exists (use --force to replace it)`);
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    file,
    `${JSON.stringify({ $schema: JSON_SCHEMA_IDS.profile, ...profile }, null, 2)}\n`,
  );
  return file;
}

export function deleteProfile(name: string): void {
  checkName(name);
  const file = join(userProfilesDir(), `${name}.json`);
  if (!existsSync(file))
    throw new ProfileError(
      `No saved profile called "${name}" (built-in profiles can't be deleted)`,
    );
  rmSync(file);
}
