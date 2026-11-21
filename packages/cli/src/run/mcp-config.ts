import type { McpServer } from "@agent-team/schema";
import type { McpUse } from "../generate.js";

export type SdkMcpServer =
  | { type: "stdio"; command: string; args: string[]; env?: Record<string, string> }
  | { type: "http"; url: string; headers?: Record<string, string> };

export class MissingEnvError extends Error {
  constructor(readonly missing: string[]) {
    super(`Set ${missing.join(", ")} before running (needed by the team's MCP servers).`);
  }
}

/**
 * The runner passes MCP servers to the SDK directly, so references are filled in here from the
 * environment rather than left as ${VAR} for Claude Code to expand.
 */
export function sdkMcpServers(
  uses: McpUse[],
  env: Record<string, string | undefined>,
): Record<string, SdkMcpServer> {
  const missing = new Set<string>();
  const fill = (text: string) =>
    text.replace(
      /\$\{(\w+)\}|\{env:(\w+)\}|^env:(\w+)$/g,
      (_, a?: string, b?: string, c?: string) => {
        const name = (a ?? b ?? c)!;
        const value = env[name];
        if (value === undefined || value === "") missing.add(name);
        return value ?? "";
      },
    );

  const out: Record<string, SdkMcpServer> = {};
  for (const use of uses) {
    if (out[use.name]) continue;
    for (const name of use.requires) if (!env[name]) missing.add(name);
    const server: McpServer = use.server;
    if (server.type === "http") {
      const headers = Object.fromEntries(
        Object.entries(server.headers).map(([k, v]) => [k, fill(v)]),
      );
      out[use.name] = {
        type: "http",
        url: fill(server.url),
        ...(Object.keys(headers).length ? { headers } : {}),
      };
    } else {
      const envVars = Object.fromEntries(Object.entries(server.env).map(([k, v]) => [k, fill(v)]));
      out[use.name] = {
        type: "stdio",
        command: fill(server.command),
        args: server.args.map(fill),
        ...(Object.keys(envVars).length ? { env: envVars } : {}),
      };
    }
  }
  if (missing.size) throw new MissingEnvError([...missing].sort());
  return out;
}
