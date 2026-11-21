import type { TeamConfigInput } from "@agent-team/schema";
import { useEffect, useState } from "react";
import { api, ApiError, type Preview } from "../api.ts";
import type { Notice } from "../App.tsx";

type Props = {
  draft: TeamConfigInput;
  errors: string[];
  notify: (n: Notice) => void;
  onApplied: () => void;
};

const KIND_LABEL = {
  create: "New",
  update: "Changed",
  delete: "Removed",
  unchanged: "Unchanged",
} as const;

export function PreviewTab({ draft, errors, notify, onApplied }: Props) {
  // Each result remembers which draft (and refresh) it was for, so stale results are never shown.
  const key = JSON.stringify(draft);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    refresh: number;
    preview?: Preview;
    problem?: string[];
  } | null>(null);
  const [confirmingFor, setConfirmingFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = errors.length === 0;

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    api.preview(JSON.parse(key) as TeamConfigInput).then(
      (preview) => !cancelled && setResult({ key, refresh, preview }),
      (err: unknown) =>
        !cancelled &&
        setResult({
          key,
          refresh,
          problem: (err as ApiError).errors?.length
            ? (err as ApiError).errors
            : [(err as Error).message],
        }),
    );
    return () => {
      cancelled = true;
    };
  }, [key, refresh, valid]);

  async function apply() {
    setBusy(true);
    try {
      const res = await api.apply(draft);
      notify({
        kind: "ok",
        text: `Wrote ${res.written.length} file(s). Run \`claude\` in the project and type /team <goal>.`,
        details: res.warnings,
      });
      onApplied();
      setConfirmingFor(null);
      setRefresh((n) => n + 1);
    } catch (err) {
      notify({ kind: "error", text: (err as Error).message, details: (err as ApiError).errors });
    } finally {
      setBusy(false);
    }
  }

  const current = result && result.key === key && result.refresh === refresh ? result : null;
  const problem = !valid ? errors : (current?.problem ?? null);
  const preview = current?.preview ?? null;
  const confirming = confirmingFor === key;
  const load = () => setRefresh((n) => n + 1);
  const setConfirming = (on: boolean) => setConfirmingFor(on ? key : null);

  if (problem) {
    return (
      <section className="panel">
        <h2>Can't preview yet</h2>
        <ul className="field-errors">
          {problem.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </section>
    );
  }
  if (!preview) return <section className="panel">Working out the changes…</section>;

  const pending = preview.changes.filter((c) => c.kind !== "unchanged");
  return (
    <>
      <section className="panel">
        <h2>The team</h2>
        <p>
          <strong>PM</strong> on {preview.pmModel} (your Claude Code session), plus{" "}
          {preview.agents.length} agent
          {preview.agents.length === 1 ? "" : "s"}:
        </p>
        <ul className="agent-list">
          {preview.agents.map((a) => (
            <li key={a.name}>
              <code>{a.name}</code> <span className="muted">{a.model}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Files</h2>
          <button className="secondary" onClick={() => void load()}>
            Refresh
          </button>
        </div>
        {preview.warnings.map((w) => (
          <p key={w} className="warn-text">
            ! {w}
          </p>
        ))}
        {pending.length === 0 ? (
          <p className="good-text">Everything is up to date. Nothing to write.</p>
        ) : (
          <ul className="changes">
            {pending.map((c) => (
              <li key={c.path}>
                <details>
                  <summary>
                    <span className={`kind ${c.kind}`}>{KIND_LABEL[c.kind]}</span>{" "}
                    <code>{c.path}</code> <span className="muted">{c.what}</span>
                  </summary>
                  <Diff text={c.diff ?? ""} />
                </details>
              </li>
            ))}
          </ul>
        )}
        {pending.length > 0 &&
          (confirming ? (
            <div className="confirm">
              <span>
                Write {pending.length} file{pending.length === 1 ? "" : "s"} to the project (and
                save team.json)?
              </span>
              <button className="primary" disabled={busy} onClick={() => void apply()}>
                Yes, write them
              </button>
              <button className="secondary" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button className="primary" onClick={() => setConfirming(true)}>
              Apply {pending.length} change{pending.length === 1 ? "" : "s"}
            </button>
          ))}
      </section>
    </>
  );
}

function Diff({ text }: { text: string }) {
  const lines = text.split("\n").slice(4); // drop the patch header
  return (
    <pre className="diff">
      {lines.map((l, i) => (
        <span
          key={i}
          className={
            l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : l.startsWith("@@") ? "hunk" : ""
          }
        >
          {l}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}
