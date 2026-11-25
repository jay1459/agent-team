import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import { findOnPath } from "./doctor.js";

/**
 * Start the team in a Claude Code session with Remote Control on, so it can be followed and
 * answered from claude.ai/code or the Claude app. Claude Code's interactive mode needs a terminal,
 * so the session runs inside a detached tmux session: one per project.
 */

export class SessionError extends Error {}

export type Exec = (
  command: string,
  args: string[],
) => { status: number | null; stdout: string; stderr: string };

const defaultExec: Exec = (command, args) => {
  const r = spawnSync(command, args, { encoding: "utf8", timeout: 20_000 });
  return {
    status: r.error ? null : r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? r.error?.message ?? "",
  };
};

export type SessionDeps = {
  exec: Exec;
  /** Full path of a command on PATH, or null. */
  which: (command: string) => string | null;
};

export const defaultSessionDeps = (): SessionDeps => ({
  exec: defaultExec,
  which: (command) => findOnPath(command, process.env),
});

/** Permission modes offered for team sessions. bypassPermissions and dontAsk are deliberately left out. */
export const SESSION_PERMISSION_MODES = ["manual", "acceptEdits", "auto", "plan"] as const;
export type SessionPermissionMode = (typeof SESSION_PERMISSION_MODES)[number];

export type SessionStatus = {
  /** tmux and claude are both installed. */
  available: boolean;
  missing: string[];
  tmuxSession: string;
  running: boolean;
  /** The claude.ai/code link Remote Control printed, once it has. */
  url?: string;
  /** What the session is waiting for on its own screen, if anything the UI can answer. */
  waitingFor?: "trust";
  /** The last lines of the session's screen. */
  screen?: string;
};

/** A tmux-safe name that's stable for a project folder. */
export function tmuxSessionName(projectDir: string): string {
  const slug =
    basename(resolve(projectDir))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 30) || "project";
  const hash = createHash("sha256").update(resolve(projectDir)).digest("hex").slice(0, 6);
  return `agent-team-${slug}-${hash}`;
}

const SESSION_URL = /https:\/\/claude\.ai\/code\/session_[A-Za-z0-9_-]+/;
const TRUST_PROMPT = /Yes, I trust this folder/;

export function sessionStatus(projectDir: string, deps: SessionDeps): SessionStatus {
  const missing = ["tmux", "claude"].filter((c) => !deps.which(c));
  const name = tmuxSessionName(projectDir);
  const base: SessionStatus = {
    available: missing.length === 0,
    missing,
    tmuxSession: name,
    running: false,
  };
  if (!deps.which("tmux")) return base;
  if (deps.exec("tmux", ["has-session", "-t", `=${name}`]).status !== 0) return base;

  const captured = deps.exec("tmux", [
    "capture-pane",
    "-p",
    "-J",
    "-t",
    `=${name}:`,
    "-S",
    "-200",
  ]).stdout;
  const lines = captured.split("\n").map((l) => l.trimEnd());
  const screen = lines
    .filter((l, i) => l || lines[i - 1])
    .join("\n")
    .trim()
    .split("\n")
    .slice(-40)
    .join("\n");
  const url = SESSION_URL.exec(captured)?.[0];
  return {
    ...base,
    running: true,
    ...(url ? { url } : {}),
    ...(TRUST_PROMPT.test(screen) ? { waitingFor: "trust" as const } : {}),
    screen,
  };
}

export type StartOptions = {
  projectDir: string;
  goal: string;
  /** Shown in claude.ai/code and the app. */
  name: string;
  permissionMode?: SessionPermissionMode;
};

export function startSession(opts: StartOptions, deps: SessionDeps): SessionStatus {
  const status = sessionStatus(opts.projectDir, deps);
  if (!status.available) {
    throw new SessionError(
      `Starting a Remote Control session needs ${status.missing.join(" and ")} on this machine.`,
    );
  }
  if (status.running)
    throw new SessionError(
      "The team is already running in a session for this project. Stop it first.",
    );

  const goal = opts.goal.replace(/\s+/g, " ").trim();
  if (!goal) throw new SessionError("Say what the team should do.");
  if (goal.length > 4000)
    throw new SessionError("Keep the goal under 4000 characters; put detail in the brief.");
  const name =
    opts.name
      .replace(/[^\p{L}\p{N} ._()-]/gu, "")
      .trim()
      .slice(0, 80) || basename(opts.projectDir);
  if (opts.permissionMode && !SESSION_PERMISSION_MODES.includes(opts.permissionMode)) {
    throw new SessionError(`Unknown permission mode "${opts.permissionMode}".`);
  }

  // tmux runs a command given as several arguments directly, without a shell, so the goal can't
  // be interpreted as shell syntax.
  const claude = [
    "claude",
    `--remote-control=${name}`,
    ...(opts.permissionMode ? ["--permission-mode", opts.permissionMode] : []),
    `/team ${goal}`,
  ];
  const r = deps.exec("tmux", [
    "new-session",
    "-d",
    "-s",
    status.tmuxSession,
    "-x",
    "200",
    "-y",
    "50",
    "-c",
    resolve(opts.projectDir),
    ...claude,
  ]);
  if (r.status !== 0)
    throw new SessionError(`Couldn't start tmux: ${r.stderr.trim() || "unknown error"}`);
  return sessionStatus(opts.projectDir, deps);
}

/** Answer Claude Code's "do you trust this folder?" question with yes. Only when it's on screen. */
export function trustFolder(projectDir: string, deps: SessionDeps): SessionStatus {
  const status = sessionStatus(projectDir, deps);
  if (status.waitingFor !== "trust")
    throw new SessionError("The session isn't asking about trusting the folder.");
  const target = `=${status.tmuxSession}:`;
  deps.exec("tmux", ["send-keys", "-t", target, "Down"]);
  deps.exec("tmux", ["send-keys", "-t", target, "Enter"]);
  return sessionStatus(projectDir, deps);
}

export function stopSession(projectDir: string, deps: SessionDeps): SessionStatus {
  const status = sessionStatus(projectDir, deps);
  if (status.running) deps.exec("tmux", ["kill-session", "-t", `=${status.tmuxSession}`]);
  return sessionStatus(projectDir, deps);
}
