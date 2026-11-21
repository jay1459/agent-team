import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  JSON_SCHEMA_IDS,
  parseTeamConfig,
  type ParseResult,
  type TeamConfig,
} from "@agent-team/schema";

export const CONFIG_FILE = "team.json";

export type ConfigFile =
  | { exists: false }
  | { exists: true; raw: unknown; result: ParseResult<TeamConfig> }
  | { exists: true; raw: null; result: { ok: false; errors: string[] } };

export function readConfigFile(path: string): ConfigFile {
  if (!existsSync(path)) return { exists: false };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    return {
      exists: true,
      raw: null,
      result: { ok: false, errors: [`Not valid JSON: ${(err as Error).message}`] },
    };
  }
  return { exists: true, raw, result: parseTeamConfig(raw) };
}

/** Write team.json with the "$schema" key first so editors pick it up. */
export function writeConfigFile(path: string, config: unknown): void {
  const rest = { ...((config ?? {}) as Record<string, unknown>) };
  delete rest.$schema;
  writeFileSync(path, `${JSON.stringify({ $schema: JSON_SCHEMA_IDS.team, ...rest }, null, 2)}\n`);
}
