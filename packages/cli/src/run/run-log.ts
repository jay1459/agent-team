import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** One line of a run log (team/runs/<id>.jsonl). */
export type RunEvent =
  | {
      kind: "start";
      at: string;
      goal: string;
      layered: boolean;
      maxBudgetUsd?: number;
      resume?: string;
      agents: string[];
    }
  | { kind: "session"; at: string; agent: string; sessionId: string; model: string }
  | { kind: "text"; at: string; agent: string; text: string }
  | { kind: "tool"; at: string; agent: string; tool: string; summary: string }
  | { kind: "delegate"; at: string; task: string }
  | { kind: "delegate-done"; at: string; ok: boolean; costUsd: number; turns: number }
  | { kind: "denied"; at: string; agent: string; tool: string; reason: string }
  | {
      kind: "result";
      at: string;
      ok: boolean;
      subtype: string;
      text: string;
      costUsd: number;
      teamCostUsd: number;
      turns: number;
      sessionId: string;
    }
  | { kind: "error"; at: string; message: string };

export type RunSummary = {
  id: string;
  goal: string;
  startedAt: string;
  status: "running" | "done" | "failed" | "stopped";
  costUsd?: number;
  sessionId?: string;
};

export const RUNS_DIR = "runs";

export class RunLog {
  readonly id: string;
  readonly file: string;

  constructor(workspaceDir: string, now = new Date()) {
    // Sortable and safe in file names on every OS.
    this.id = now.toISOString().replace(/[:.]/g, "-");
    const dir = join(workspaceDir, RUNS_DIR);
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, `${this.id}.jsonl`);
  }

  write(event: RunEvent): void {
    appendFileSync(this.file, `${JSON.stringify(event)}\n`);
  }
}

const ID = /^[0-9TZ-]+$/;

export function readRun(workspaceDir: string, id: string): RunEvent[] | null {
  if (!ID.test(id)) return null;
  const file = join(workspaceDir, RUNS_DIR, `${id}.jsonl`);
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as RunEvent];
      } catch {
        return []; // a line cut short by a crash
      }
    });
}

export function summariseRun(id: string, events: RunEvent[]): RunSummary {
  const start = events.find((e) => e.kind === "start");
  const result = events.findLast((e) => e.kind === "result");
  const error = events.findLast((e) => e.kind === "error");
  const session = events.findLast((e) => e.kind === "session" && e.agent === "pm");
  return {
    id,
    goal: start?.kind === "start" ? start.goal : "",
    startedAt: start?.at ?? "",
    status:
      result?.kind === "result" ? (result.ok ? "done" : "stopped") : error ? "failed" : "running",
    ...(result?.kind === "result"
      ? { costUsd: result.costUsd + result.teamCostUsd, sessionId: result.sessionId }
      : {}),
    ...(!result && session?.kind === "session" ? { sessionId: session.sessionId } : {}),
  };
}

/** Newest first. */
export function listRuns(workspaceDir: string): RunSummary[] {
  const dir = join(workspaceDir, RUNS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => f.slice(0, -".jsonl".length))
    .filter((id) => ID.test(id))
    .sort()
    .reverse()
    .map((id) => summariseRun(id, readRun(workspaceDir, id) ?? []));
}
