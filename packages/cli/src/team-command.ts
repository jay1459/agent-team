import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type { Catalog } from "./catalog.js";
import { render } from "./generate.js";

/**
 * A user-level /team command, so a Claude Code session started anywhere (e.g. the folder that holds
 * all your projects) can start a team in one of them. Claude Code lets a user command take
 * precedence over a project command with the same name, so this one also does the project's own
 * job when the session is already inside a project with a team.
 */

export const USER_COMMAND_MARKER =
  "Installed by agent-team install-command. Re-run it to update, or run it with --uninstall to remove.";

export class CommandError extends Error {}

/** Where Claude Code looks for user commands. */
export function userCommandPath(env: Record<string, string | undefined> = process.env): string {
  return join(env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "commands", "team.md");
}

/** How the command should call this agent-team: the same Node and script that's running now. */
export function cliInvocation(scriptPath: string, nodePath = process.execPath): string {
  const quote = (p: string) => (/^[\w@%+=:,./-]+$/.test(p) ? p : `'${p.replace(/'/g, "'\\''")}'`);
  return `${quote(nodePath)} ${quote(existsSync(scriptPath) ? realpathSync(scriptPath) : scriptPath)}`;
}

export function userCommandContent(catalog: Catalog, cli: string): string {
  const frontmatter = stringifyYaml(
    {
      description:
        "Run an agent team: here if this project has one, or start one in another project with Remote Control",
      "argument-hint": "[project] <goal>",
    },
    { lineWidth: 0 },
  );
  return `---\n${frontmatter}---\n\n<!-- ${USER_COMMAND_MARKER} -->\n\n${render(catalog.templates.userTeamCommand, { cli })}\n`;
}

export function installUserCommand(
  catalog: Catalog,
  cli: string,
  opts: { force?: boolean; env?: Record<string, string | undefined> } = {},
): { path: string; replaced: boolean } {
  const path = userCommandPath(opts.env);
  const existing = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (existing !== null && !existing.includes(USER_COMMAND_MARKER) && !opts.force) {
    throw new CommandError(
      `${path} already exists and wasn't installed by agent-team. Use --force to replace it.`,
    );
  }
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, userCommandContent(catalog, cli));
  return { path, replaced: existing !== null };
}

export function uninstallUserCommand(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const path = userCommandPath(env);
  if (!existsSync(path)) return null;
  if (!readFileSync(path, "utf8").includes(USER_COMMAND_MARKER)) {
    throw new CommandError(`${path} wasn't installed by agent-team, so it was left alone.`);
  }
  rmSync(path);
  return path;
}
