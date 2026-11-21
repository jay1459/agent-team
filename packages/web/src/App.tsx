import { parseTeamConfig, teamConfigFromProfile, type TeamConfigInput } from "@agent-team/schema";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, takeToken, type UiState } from "./api.ts";
import { JsonTab } from "./components/JsonTab.tsx";
import { PreviewTab } from "./components/PreviewTab.tsx";
import { ProfilesTab } from "./components/ProfilesTab.tsx";
import { RunsTab } from "./components/RunsTab.tsx";
import { SpecialistsTab } from "./components/SpecialistsTab.tsx";
import { TeamTab } from "./components/TeamTab.tsx";
import { Welcome } from "./components/Welcome.tsx";
import { WorkflowTab } from "./components/WorkflowTab.tsx";
import { errorsUnder } from "./util.ts";

export type Edit = (change: (draft: TeamConfigInput) => void) => void;

type Tab = "team" | "specialists" | "workflow" | "profiles" | "preview" | "runs" | "json";

const TABS: { id: Tab; label: string; paths: string[] }[] = [
  { id: "team", label: "Team", paths: ["project", "defaults", "roles"] },
  { id: "specialists", label: "Specialists", paths: ["specialists"] },
  { id: "workflow", label: "Workflow", paths: ["workflow", "secrets", "runner"] },
  { id: "profiles", label: "Profiles", paths: ["extends"] },
  { id: "preview", label: "Preview & apply", paths: [] },
  { id: "runs", label: "Runs", paths: [] },
  { id: "json", label: "JSON", paths: ["(root)", "version", "$schema"] },
];

export type Notice = { kind: "ok" | "error"; text: string; details?: string[] } | null;

export function App() {
  const [hasToken] = useState(() => Boolean(takeToken()));
  const [state, setState] = useState<UiState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<TeamConfigInput | null>(null);
  const [saved, setSaved] = useState<string>("null");
  const [tab, setTab] = useState<Tab>("team");
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  const loaded = useCallback((s: UiState) => {
    setState(s);
    setDraft(s.config);
    setSaved(JSON.stringify(s.config));
    setLoadError(null);
  }, []);
  const failed = useCallback((err: unknown) => {
    setLoadError(err instanceof ApiError && err.status === 401 ? "token" : (err as Error).message);
  }, []);
  const reload = () => api.state().then(loaded, failed);

  useEffect(() => {
    if (!hasToken) return;
    let cancelled = false;
    api.state().then(
      (s) => !cancelled && loaded(s),
      (err: unknown) => !cancelled && failed(err),
    );
    return () => {
      cancelled = true;
    };
  }, [hasToken, loaded, failed]);

  const refreshProfiles = useCallback(async () => {
    const profiles = await api.profiles();
    setState((s) => (s ? { ...s, profiles } : s));
  }, []);

  const dirty = JSON.stringify(draft) !== saved;
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [dirty]);

  const errors = useMemo(() => {
    if (!draft) return [];
    const result = parseTeamConfig(draft);
    return result.ok ? [] : result.errors;
  }, [draft]);

  const edit: Edit = useCallback((change) => {
    setDraft((d) => {
      if (!d) return d;
      const copy = structuredClone(d);
      change(copy);
      return copy;
    });
  }, []);

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      await api.save(draft);
      setSaved(JSON.stringify(draft));
      setState((s) => (s ? { ...s, exists: true } : s));
      setNotice({ kind: "ok", text: "Saved team.json." });
    } catch (err) {
      setNotice({ kind: "error", text: (err as Error).message, details: (err as ApiError).errors });
    } finally {
      setBusy(false);
    }
  }

  if (!hasToken || loadError === "token") {
    return (
      <main className="centred">
        <h1>agent-team</h1>
        <p>
          This page needs the link printed by <code>agent-team ui</code>, which includes an access
          token. Open that link, or restart <code>agent-team ui</code> to get a new one.
        </p>
      </main>
    );
  }
  if (loadError) {
    return (
      <main className="centred">
        <h1>agent-team</h1>
        <p className="error">Couldn't reach the agent-team server: {loadError}</p>
        <button onClick={() => void reload()}>Try again</button>
      </main>
    );
  }
  if (!state) return <main className="centred">Loading…</main>;

  if (!draft) {
    return (
      <Welcome
        state={state}
        onStart={async (profileName, projectName) => {
          const profile = await api.profile(profileName);
          setDraft(teamConfigFromProfile(profile, { name: projectName }) as TeamConfigInput);
          setTab("team");
        }}
      />
    );
  }

  const countFor = (t: (typeof TABS)[number]) =>
    t.paths.reduce((n, p) => n + errorsUnder(errors, p).length, 0);

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>agent-team</h1>
          <div className="muted small" title={state.configPath}>
            {state.projectDir}
          </div>
        </div>
        <div className="topbar-actions">
          <span
            className={`status ${errors.length ? "bad" : dirty ? "warn" : "good"}`}
            role="status"
          >
            {errors.length
              ? `${errors.length} problem${errors.length === 1 ? "" : "s"}`
              : dirty
                ? state.exists
                  ? "Unsaved changes"
                  : "Not saved yet"
                : "Saved"}
          </span>
          <button
            className="primary"
            disabled={!dirty || errors.length > 0 || busy}
            onClick={() => void save()}
          >
            Save
          </button>
        </div>
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => {
          const n = countFor(t);
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? "tab active" : "tab"}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {n > 0 && (
                <span className="badge" aria-label={`${n} problems`}>
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {notice && (
        <div className={`notice ${notice.kind}`} role="alert">
          <span>{notice.text}</span>
          {notice.details && notice.details.length > 0 && notice.details[0] !== notice.text && (
            <ul>
              {notice.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
          <button className="link" onClick={() => setNotice(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <main className="content">
        {tab === "team" && (
          <TeamTab draft={draft} edit={edit} catalog={state.catalog} errors={errors} />
        )}
        {tab === "specialists" && (
          <SpecialistsTab draft={draft} edit={edit} catalog={state.catalog} errors={errors} />
        )}
        {tab === "workflow" && (
          <WorkflowTab draft={draft} edit={edit} catalog={state.catalog} errors={errors} />
        )}
        {tab === "profiles" && (
          <ProfilesTab
            draft={draft}
            setDraft={setDraft}
            profiles={state.profiles}
            errors={errors}
            onChanged={refreshProfiles}
            notify={setNotice}
          />
        )}
        {tab === "preview" && (
          <PreviewTab
            draft={draft}
            errors={errors}
            notify={setNotice}
            onApplied={() => {
              setSaved(JSON.stringify(draft));
              setState((s) => (s ? { ...s, exists: true } : s));
            }}
          />
        )}
        {tab === "runs" && <RunsTab />}
        {tab === "json" && <JsonTab draft={draft} setDraft={setDraft} errors={errors} />}
      </main>
    </div>
  );
}
