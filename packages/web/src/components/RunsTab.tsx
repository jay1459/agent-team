import { useEffect, useState } from "react";
import { api, type RunEvent, type RunSummary } from "../api.ts";

const money = (n: unknown) => (typeof n === "number" ? `$${n.toFixed(2)}` : "");

export function RunsTab() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [events, setEvents] = useState<{ id: string; events: RunEvent[] } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.runs().then(
      (r) => !cancelled && setRuns(r),
      (err: Error) => !cancelled && setError(err.message),
    );
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    api.run(selected).then(
      (e) => !cancelled && setEvents({ id: selected, events: e }),
      (err: Error) => !cancelled && setError(err.message),
    );
    return () => {
      cancelled = true;
    };
  }, [selected, refresh]);

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Runs</h2>
          <button className="secondary" onClick={() => setRefresh((n) => n + 1)}>
            Refresh
          </button>
        </div>
        <p className="muted">
          Start a run in a terminal with <code>agent-team run "&lt;goal&gt;"</code>, and answer the
          PM with <code>agent-team run --continue "&lt;reply&gt;"</code>. Runs use the Claude Agent
          SDK and cost money; set a budget on the Workflow tab.
        </p>
        {error && <p className="error">{error}</p>}
        {runs && runs.length === 0 && <p>No runs yet.</p>}
        {runs && runs.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Started</th>
                <th>Goal</th>
                <th>Status</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className={selected === r.id ? "selected" : ""}>
                  <td>
                    <button className="link" onClick={() => setSelected(r.id)}>
                      {r.startedAt ? new Date(r.startedAt).toLocaleString() : r.id}
                    </button>
                  </td>
                  <td>{r.goal}</td>
                  <td>
                    <span className={`run-status ${r.status}`}>{r.status}</span>
                  </td>
                  <td>{money(r.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {selected && events?.id === selected && (
        <section className="panel">
          <h2>Log</h2>
          <ol className="run-log">
            {events.events.map((e, i) => (
              <li key={i} className={`ev ${e.kind}`}>
                <EventLine e={e} />
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}

function EventLine({ e }: { e: RunEvent }) {
  const s = (k: string) => String(e[k] ?? "");
  switch (e.kind) {
    case "start":
      return (
        <>
          <strong>Goal:</strong> {s("goal")}{" "}
          {e.layered ? <span className="pill">layered</span> : null}
        </>
      );
    case "session":
      return (
        <span className="muted">
          {s("agent")} session on {s("model")}
        </span>
      );
    case "text":
      return (
        <>
          <strong>{s("agent")}</strong>
          <div className="ev-text">{s("text")}</div>
        </>
      );
    case "tool":
      return (
        <span className="muted">
          {s("agent")} → <code>{s("tool")}</code> {s("summary")}
        </span>
      );
    case "delegate":
      return (
        <>
          <strong>pm ⇒ lead-dev team:</strong> {s("task")}
        </>
      );
    case "delegate-done":
      return (
        <span className="muted">
          lead-dev team finished ({e.ok ? "ok" : "stopped"}, {money(e.costUsd)})
        </span>
      );
    case "denied":
      return (
        <span className="warn-text">
          {s("agent")} wasn't allowed {s("tool")}: {s("reason")}
        </span>
      );
    case "result":
      return (
        <>
          <strong>{e.ok ? "Finished" : `Stopped (${s("subtype")})`}</strong> ·{" "}
          {money(Number(e.costUsd) + Number(e.teamCostUsd))} · {s("turns")} turns
          {s("text") && <div className="ev-text">{s("text")}</div>}
        </>
      );
    case "error":
      return <span className="error">Error: {s("message")}</span>;
    default:
      return <code>{JSON.stringify(e)}</code>;
  }
}
