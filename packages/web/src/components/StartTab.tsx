import type { TeamConfigInput } from "@agent-team/schema";
import { useEffect, useState } from "react";
import { api, ApiError, type SessionPermissionMode, type SessionStatus } from "../api.ts";
import { Field } from "./fields.tsx";

const MODES: { value: "" | SessionPermissionMode; label: string }[] = [
  { value: "", label: "Use my Claude Code settings" },
  { value: "manual", label: "Ask me before actions" },
  { value: "acceptEdits", label: "Edit files without asking; ask before commands" },
  { value: "auto", label: "Auto mode: Claude decides what's safe to run" },
  { value: "plan", label: "Plan only: no changes" },
];

type Props = { draft: TeamConfigInput; dirty: boolean; valid: boolean; onApplied: () => void };

/** Start the team in a Claude Code session with Remote Control, to follow from the phone or claude.ai. */
export function StartTab({ draft, dirty, valid, onApplied }: Props) {
  const projectName = draft.project.name;
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [goal, setGoal] = useState("");
  const [name, setName] = useState(`${projectName} team`);
  const [mode, setMode] = useState<"" | SessionPermissionMode>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Poll while the tab is open: the session's link and questions appear on its screen over time.
  useEffect(() => {
    let cancelled = false;
    api.session().then(
      (s) => !cancelled && setStatus(s),
      (err: Error) => !cancelled && setError(err.message),
    );
    const timer = setTimeout(() => setTick((n) => n + 1), 3000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tick]);

  async function act(fn: () => Promise<SessionStatus>) {
    setBusy(true);
    setError(null);
    try {
      setStatus(await fn());
    } catch (err) {
      setError((err as ApiError).errors?.[0] ?? (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!status)
    return (
      <section className="panel">{error ? <p className="error">{error}</p> : "Checking…"}</section>
    );

  if (!status.available) {
    return (
      <section className="panel">
        <h2>Start the team</h2>
        <p>
          Starting a session from here needs <strong>{status.missing.join(" and ")}</strong> on the
          machine running agent-team. You can still start it yourself: run{" "}
          <code>claude --remote-control</code> in the project and type{" "}
          <code>/team &lt;goal&gt;</code>.
        </p>
      </section>
    );
  }

  if (status.running) {
    return (
      <section className="panel">
        <div className="panel-head">
          <h2>The team is running</h2>
          <button
            className="danger"
            disabled={busy}
            onClick={() => confirm("Stop the team's session?") && void act(api.stopSession)}
          >
            Stop session
          </button>
        </div>
        {status.url ? (
          <p className="good-text">
            Follow and answer it on your phone in the Claude app, or at{" "}
            <a href={status.url} target="_blank" rel="noreferrer">
              {status.url}
            </a>
          </p>
        ) : (
          <p className="muted">Waiting for Remote Control to connect…</p>
        )}
        {status.waitingFor === "trust" && (
          <div className="confirm">
            <span>
              Claude Code is asking whether you trust this project's folder before it starts.
            </span>
            <button className="primary" disabled={busy} onClick={() => void act(api.trustSession)}>
              Yes, trust this folder
            </button>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <details open={!status.url}>
          <summary>Session screen</summary>
          <pre className="prompt screen">{status.screen}</pre>
        </details>
        <p className="hint">
          It runs in tmux session <code>{status.tmuxSession}</code> on the machine running
          agent-team; attach with <code>tmux attach -t {status.tmuxSession}</code>.
        </p>
      </section>
    );
  }

  const needsApply = status.upToDate === false || dirty;
  return (
    <section className="panel">
      <h2>Start the team</h2>
      <p className="muted">
        Starts Claude Code in this project with Remote Control on and gives the PM your goal. You
        can then follow the team and answer its questions in the Claude app or on claude.ai/code. It
        uses your Claude plan's usage.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            // The server starts from team.json, so save unsaved edits first.
            if (dirty) await api.save(draft);
            const s = await api.startSession({
              goal,
              name,
              apply: needsApply,
              ...(mode ? { permissionMode: mode } : {}),
            });
            if (needsApply) onApplied();
            return s;
          });
        }}
      >
        <Field label="Goal for the PM">
          {(id) => (
            <textarea
              id={id}
              rows={3}
              value={goal}
              placeholder="Plan and build … Start with the requirements and an architecture for me to review."
              onChange={(e) => setGoal(e.target.value)}
            />
          )}
        </Field>
        <div className="grid-2">
          <Field
            label="Session name"
            hint="How it appears in the Claude app and on claude.ai/code."
          >
            {(id) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Permissions">
            {(id) => (
              <select id={id} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                {MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        {needsApply && valid && (
          <p className="hint">The team's files will be saved and applied first.</p>
        )}
        {!valid && <p className="error">Fix the problems in the team first.</p>}
        <button className="primary" type="submit" disabled={busy || !goal.trim() || !valid}>
          {needsApply ? "Apply and start Remote Control session" : "Start Remote Control session"}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </section>
  );
}
