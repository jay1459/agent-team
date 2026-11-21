import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentDefinition,
  CanUseTool,
  McpServerConfig,
  Options,
  SDKMessage,
  createSdkMcpServer as CreateSdkMcpServer,
  tool as Tool,
} from "@anthropic-ai/claude-agent-sdk";
import type { TeamConfig } from "@agent-team/schema";
import { z } from "zod";
import type { Catalog } from "../catalog.js";
import { generate, PATHS, type Generated } from "../generate.js";
import { SECTION_END, SECTION_START } from "../plan.js";
import { sdkMcpServers } from "./mcp-config.js";
import { RunLog, type RunEvent } from "./run-log.js";

/** The parts of the Agent SDK the runner uses; injected so tests can use a fake. */
export type Sdk = {
  query: (params: { prompt: string; options?: Options }) => AsyncIterable<SDKMessage>;
  createSdkMcpServer: typeof CreateSdkMcpServer;
  tool: typeof Tool;
};

export class RunError extends Error {}

export const SDK_PACKAGE = "@anthropic-ai/claude-agent-sdk";

/** Load the SDK only when a run starts, so the rest of agent-team works without it. */
export async function loadSdk(): Promise<Sdk> {
  try {
    const sdk = (await import(SDK_PACKAGE)) as Sdk;
    return { query: sdk.query, createSdkMcpServer: sdk.createSdkMcpServer, tool: sdk.tool };
  } catch (err) {
    if ((err as { code?: string }).code === "ERR_MODULE_NOT_FOUND") {
      throw new RunError(
        `agent-team run needs the Claude Agent SDK, installed next to agent-team:\n  npm install -g ${SDK_PACKAGE}     (if agent-team is installed globally)\n  npm install ${SDK_PACKAGE}        (if it's installed in this project)\nor, with npx:\n  npx -p @jay1459/agent-team -p ${SDK_PACKAGE} agent-team run "<goal>"`,
      );
    }
    throw err;
  }
}

export type RunInput = {
  projectDir: string;
  config: TeamConfig;
  catalog: Catalog;
  /** The goal, or the reply when resuming. */
  goal: string;
  /** Session to continue (from an earlier run's result). */
  resume?: string;
  layered?: boolean;
  maxBudgetUsd?: number;
  /** Allow every tool call without asking. */
  approveAll?: boolean;
  env: Record<string, string | undefined>;
  /** Ask the person running agent-team; resolve false when nobody can answer. */
  ask: (question: string) => Promise<boolean>;
  onEvent?: (event: RunEvent) => void;
  sdk: Sdk;
  abortController?: AbortController;
  now?: () => Date;
};

export type RunOutcome = {
  ok: boolean;
  log: RunLog;
  result?: Extract<RunEvent, { kind: "result" }>;
};

export const DELEGATE_TOOL = "delegate_to_lead_dev";
const TEAM_SERVER = "agent_team";

const RUNNER_NOTE = `## Running unattended

You are running through \`agent-team run\`, not an interactive chat. When you reach an approval gate
or need a decision, stop: record where things stand in the backlog, then end your turn with a short,
clear question. The person will continue the run with their answer.`;

/** The project's own CLAUDE.md, without agent-team's section (that is supplied separately). */
export function projectNotes(projectDir: string): string {
  const file = join(projectDir, PATHS.claudeMd);
  if (!existsSync(file)) return "";
  const text = readFileSync(file, "utf8");
  const start = text.indexOf(SECTION_START);
  const end = text.indexOf(SECTION_END);
  const outside =
    start >= 0 && end > start ? text.slice(0, start) + text.slice(end + SECTION_END.length) : text;
  return outside.trim();
}

function agentDefinitions(
  generated: Generated,
  names?: (name: string) => boolean,
): Record<string, AgentDefinition> {
  const out: Record<string, AgentDefinition> = {};
  for (const a of generated.agents) {
    if (names && !names(a.name)) continue;
    out[a.name] = {
      description: a.description,
      prompt: generated.prompts[a.name]!,
      tools: a.tools,
      ...(a.model === "inherit" ? {} : { model: a.model }),
    };
  }
  return out;
}

function systemAppend(...parts: string[]): string {
  return parts.filter((p) => p.trim()).join("\n\n");
}

const clip = (text: string, max = 160) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** A one-line description of a tool call for the console and the run log. */
export function summariseInput(tool: string, input: Record<string, unknown>): string {
  const pick = (...keys: string[]) =>
    keys.map((k) => input[k]).find((v) => typeof v === "string") as string | undefined;
  const value =
    tool === "Agent" || tool === "Task"
      ? `${String(input.subagent_type ?? "agent")}: ${pick("description", "prompt") ?? ""}`
      : (pick("command", "file_path", "path", "pattern", "url", "query", "task") ??
        JSON.stringify(input));
  return clip(value.replace(/\s+/g, " ").trim());
}

/** Run the team on a goal. Every message is written to <workspace>/runs/<id>.jsonl. */
export async function runTeam(input: RunInput): Promise<RunOutcome> {
  const { config, catalog, projectDir, sdk } = input;
  const now = input.now ?? (() => new Date());
  const at = () => now().toISOString();
  const layered = input.layered ?? config.runner.layered;
  const maxBudgetUsd = input.maxBudgetUsd ?? config.runner.maxBudgetUsd;

  const full = generate(config, catalog);
  if (
    layered &&
    !(
      full.agents.some((a) => a.name === "lead-dev") &&
      full.agents.some((a) => a.name.startsWith("developer"))
    )
  ) {
    throw new RunError("A layered run needs both the lead developer and developers switched on.");
  }

  // In a layered team the PM doesn't see the developers or the lead developer as subagents:
  // it hands build work to the lead developer's own session through a tool.
  const pmView = layered
    ? generate(
        {
          ...config,
          roles: {
            ...config.roles,
            "lead-dev": { ...config.roles["lead-dev"]!, enabled: false },
            developer: { ...config.roles.developer!, enabled: false },
          },
        },
        catalog,
      )
    : full;

  const workspaceDir = join(projectDir, config.workflow.workspace);
  const log = new RunLog(workspaceDir, now());
  const emit = (event: RunEvent) => {
    log.write(event);
    input.onEvent?.(event);
  };

  const notes = projectNotes(projectDir);
  const projectSection = notes ? `# Project instructions (from CLAUDE.md)\n\n${notes}` : "";
  const mcpServers: Record<string, McpServerConfig> = sdkMcpServers(full.mcp, input.env);

  const canUseTool =
    (agent: string): CanUseTool =>
    async (toolName, toolInput) => {
      if (toolName.startsWith(`mcp__${TEAM_SERVER}__`) || input.approveAll) {
        return { behavior: "allow", updatedInput: toolInput };
      }
      const summary = summariseInput(toolName, toolInput);
      if (await input.ask(`${agent} wants to use ${toolName}: ${summary}`)) {
        return { behavior: "allow", updatedInput: toolInput };
      }
      emit({ kind: "denied", at: at(), agent, tool: toolName, reason: summary });
      return {
        behavior: "deny",
        message:
          "The person running agent-team said no to this. Try another way, or stop and ask them.",
      };
    };

  /** Log one SDK message. Returns the result message when the query ends. */
  const subagentOf = new Map<string, string>();
  function handle(message: SDKMessage, agent: string) {
    if (message.type === "system" && message.subtype === "init") {
      emit({
        kind: "session",
        at: at(),
        agent,
        sessionId: message.session_id,
        model: message.model,
      });
    } else if (message.type === "assistant") {
      const who = message.parent_tool_use_id
        ? (subagentOf.get(message.parent_tool_use_id) ?? `${agent}/subagent`)
        : agent;
      for (const block of message.message.content) {
        if (block.type === "text" && block.text.trim()) {
          emit({ kind: "text", at: at(), agent: who, text: block.text.trim() });
        } else if (block.type === "tool_use") {
          const toolInput = (block.input ?? {}) as Record<string, unknown>;
          if (
            (block.name === "Agent" || block.name === "Task") &&
            typeof toolInput.subagent_type === "string"
          ) {
            subagentOf.set(block.id, toolInput.subagent_type);
          }
          emit({
            kind: "tool",
            at: at(),
            agent: who,
            tool: block.name,
            summary: summariseInput(block.name, toolInput),
          });
        }
      }
    } else if (message.type === "result") {
      return message;
    }
    return undefined;
  }

  // Layered mode: the lead developer's team, run as its own session per hand-off ---------------
  let teamCostUsd = 0;
  if (layered) {
    const leadDev = full.agents.find((a) => a.name === "lead-dev")!;
    const developers = agentDefinitions(
      full,
      (n) => n === "developer" || n.startsWith("developer-"),
    );
    const devRoster = Object.entries(developers)
      .map(([name, d]) => `- \`${name}\` (${d.model ?? "inherit"})`)
      .join("\n");
    const teamBudget = config.runner.teamBudgetUsd;

    const delegate = sdk.tool(
      DELEGATE_TOOL,
      "Hand build work to the lead developer, who plans it, directs their developers and reviews the result. Give one task with the goal, the files or design involved and the acceptance criteria. Returns the lead developer's report.",
      { task: z.string().min(1).describe("The task, with everything the lead developer needs") },
      async ({ task }) => {
        emit({ kind: "delegate", at: at(), task: clip(task, 500) });
        const remaining = maxBudgetUsd === undefined ? undefined : maxBudgetUsd - teamCostUsd;
        if (remaining !== undefined && remaining <= 0) {
          return {
            content: [
              {
                type: "text",
                text: "The run's budget is used up, so the team can't start this task.",
              },
            ],
            isError: true,
          };
        }
        const cap = [teamBudget, remaining].filter((v): v is number => v !== undefined);
        let result: Extract<SDKMessage, { type: "result" }> | undefined;
        for await (const message of sdk.query({
          prompt: task,
          options: {
            cwd: projectDir,
            ...(leadDev.model === "inherit" ? {} : { model: leadDev.model }),
            agents: developers,
            settingSources: [],
            systemPrompt: {
              type: "preset",
              preset: "claude_code",
              append: systemAppend(
                full.prompts["lead-dev"]!,
                `## Your developers\n\nYou direct these developers. Hand each one a single task with the Agent tool, using its name as the subagent type, then review what comes back before reporting to the project manager:\n\n${devRoster}`,
                projectSection,
              ),
            },
            permissionMode: config.runner.permissionMode,
            canUseTool: canUseTool("lead-dev"),
            ...(cap.length ? { maxBudgetUsd: Math.min(...cap) } : {}),
            ...(input.abortController ? { abortController: input.abortController } : {}),
          },
        })) {
          result = handle(message, "lead-dev") ?? result;
        }
        const cost = result?.total_cost_usd ?? 0;
        teamCostUsd += cost;
        const ok = result?.subtype === "success" && !result.is_error;
        emit({ kind: "delegate-done", at: at(), ok, costUsd: cost, turns: result?.num_turns ?? 0 });
        const text =
          result?.subtype === "success"
            ? result.result
            : `The lead developer's session stopped early (${result?.subtype ?? "no result"}).`;
        return { content: [{ type: "text", text }], ...(ok ? {} : { isError: true }) };
      },
    );
    mcpServers[TEAM_SERVER] = sdk.createSdkMcpServer({ name: TEAM_SERVER, tools: [delegate] });
  }

  const layeredNote = layered
    ? `## Your development team\n\nThe lead developer runs the developers (${Object.keys(agentDefinitions(full, (n) => n.startsWith("developer"))).length}) as their own team. To get code designed into tasks, built and reviewed, call the \`${DELEGATE_TOOL}\` tool with one task at a time. Don't write production code yourself.`
    : "";

  emit({
    kind: "start",
    at: at(),
    goal: input.goal,
    layered,
    ...(maxBudgetUsd === undefined ? {} : { maxBudgetUsd }),
    ...(input.resume ? { resume: input.resume } : {}),
    agents: [...pmView.agents.map((a) => a.name), ...(layered ? ["lead-dev (team)"] : [])],
  });

  let result: Extract<SDKMessage, { type: "result" }> | undefined;
  try {
    for await (const message of sdk.query({
      prompt: input.goal,
      options: {
        cwd: projectDir,
        ...(full.pmModel === "inherit" ? {} : { model: full.pmModel }),
        agents: agentDefinitions(pmView),
        settingSources: [],
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: systemAppend(pmView.claudeSection, layeredNote, RUNNER_NOTE, projectSection),
        },
        mcpServers,
        permissionMode: config.runner.permissionMode,
        canUseTool: canUseTool("pm"),
        ...(maxBudgetUsd === undefined ? {} : { maxBudgetUsd }),
        ...(input.resume ? { resume: input.resume } : {}),
        ...(input.abortController ? { abortController: input.abortController } : {}),
      },
    })) {
      result = handle(message, "pm") ?? result;
    }
  } catch (err) {
    emit({ kind: "error", at: at(), message: (err as Error).message });
    return { ok: false, log };
  }

  if (!result) {
    emit({ kind: "error", at: at(), message: "The run ended without a result." });
    return { ok: false, log };
  }
  const event: Extract<RunEvent, { kind: "result" }> = {
    kind: "result",
    at: at(),
    ok: result.subtype === "success" && !result.is_error,
    subtype: result.subtype,
    text: result.subtype === "success" ? result.result : (result.errors ?? []).join("\n"),
    costUsd: result.total_cost_usd,
    teamCostUsd,
    turns: result.num_turns,
    sessionId: result.session_id,
  };
  emit(event);
  return { ok: event.ok, log, result: event };
}
