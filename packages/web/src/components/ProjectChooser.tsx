import { useEffect, useState } from "react";
import { api, ApiError, type ProjectListing, type UiState } from "../api.ts";
import { Field } from "./fields.tsx";

type Mode = "open" | "clone" | "create";

/** First step: the git repository the team works in. Never agent-team's own folder. */
export function ProjectChooser({
  state,
  onChosen,
  onCancel,
}: {
  state: UiState;
  onChosen: () => void;
  onCancel?: () => void;
}) {
  const [mode, setMode] = useState<Mode>("create");
  const [projects, setProjects] = useState<ProjectListing[]>([]);
  const [path, setPath] = useState("");
  const [init, setInit] = useState(false);
  const [url, setUrl] = useState("");
  const [folder, setFolder] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [github, setGithub] = useState<"" | "private" | "public">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.projects().then(
      (p) => !cancelled && setProjects(p),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const chosen = projects.find((p) => p.dir === path || p.name === path);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (mode === "open") await api.openProject(path, init);
      else if (mode === "clone") await api.cloneProject(url, folder || undefined);
      else await api.createProject(name, github || null, description || undefined);
      onChosen();
    } catch (err) {
      setError((err as ApiError).errors?.[0] ?? (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const ready =
    mode === "open"
      ? Boolean(path.trim())
      : mode === "clone"
        ? Boolean(url.trim())
        : Boolean(name.trim());

  return (
    <main className="centred wide">
      <h1>agent-team</h1>
      <p>
        Where should the team work? Its code, documents and decisions go in a git repository of its
        own, never in agent-team's folder.
      </p>
      {state.projectProblem && <p className="warn-text">{state.projectProblem}</p>}

      <div className="mode-tabs" role="radiogroup" aria-label="Project">
        {(
          [
            ["create", "Create a new repository"],
            ["open", "Use an existing repository"],
            ["clone", "Clone a repository"],
          ] as const
        ).map(([m, label]) => (
          <label key={m} className={`mode ${mode === m ? "active" : ""}`}>
            <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
            {label}
          </label>
        ))}
      </div>

      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {mode === "create" && (
          <>
            <Field label="Repository name" hint={`Created in ${state.projectsRoot}`}>
              {(id) => (
                <input
                  id={id}
                  value={name}
                  placeholder="my-project"
                  onChange={(e) => setName(e.target.value)}
                />
              )}
            </Field>
            <Field label="Description">
              {(id) => (
                <input
                  id={id}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              )}
            </Field>
            <Field
              label="Also create it on GitHub"
              hint="Uses the GitHub CLI (gh) signed in on this machine."
            >
              {(id) => (
                <select
                  id={id}
                  value={github}
                  onChange={(e) => setGithub(e.target.value as typeof github)}
                >
                  <option value="">No, local only</option>
                  <option value="private">Yes, private</option>
                  <option value="public">Yes, public</option>
                </select>
              )}
            </Field>
          </>
        )}

        {mode === "open" && (
          <>
            {projects.length > 0 && (
              <fieldset className="profiles">
                <legend>In {state.projectsRoot}</legend>
                {projects.map((p) => (
                  <label key={p.dir} className="inline">
                    <input
                      type="radio"
                      name="existing"
                      checked={path === p.dir}
                      onChange={() => setPath(p.dir)}
                    />
                    <strong>{p.name}</strong>
                    <span className="muted">
                      {p.isRepo ? "git repository" : "not a git repository"}
                      {p.hasTeam ? " · has a team" : ""}
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            <Field
              label="Folder"
              hint={`A folder inside ${state.projectsRoot}, by name or full path.`}
            >
              {(id) => <input id={id} value={path} onChange={(e) => setPath(e.target.value)} />}
            </Field>
            {(!chosen || !chosen.isRepo) && (
              <label className="inline">
                <input type="checkbox" checked={init} onChange={(e) => setInit(e.target.checked)} />
                Make it a git repository if it isn't one yet
              </label>
            )}
          </>
        )}

        {mode === "clone" && (
          <>
            <Field label="Repository address" hint="https://, ssh:// or git@host: address.">
              {(id) => (
                <input
                  id={id}
                  value={url}
                  placeholder="https://github.com/you/project.git"
                  onChange={(e) => setUrl(e.target.value)}
                />
              )}
            </Field>
            <Field
              label="Folder name"
              hint={`Cloned into ${state.projectsRoot}. Leave empty to use the repository's name.`}
            >
              {(id) => <input id={id} value={folder} onChange={(e) => setFolder(e.target.value)} />}
            </Field>
          </>
        )}

        <div className="confirm">
          <button className="primary" type="submit" disabled={!ready || busy}>
            {busy
              ? "Working…"
              : mode === "create"
                ? "Create repository"
                : mode === "clone"
                  ? "Clone"
                  : "Use this repository"}
          </button>
          {onCancel && (
            <button type="button" className="secondary" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
        {error && <p className="error">{error}</p>}
      </form>
    </main>
  );
}
