import { useState } from "react";
import type { UiState } from "../api.ts";
import { Field } from "./fields.tsx";

export function Welcome({
  state,
  onStart,
  onChangeProject,
}: {
  state: UiState;
  onStart: (profile: string, project: string) => Promise<void>;
  onChangeProject: () => void;
}) {
  const folder = (state.projectDir ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "My project";
  const [project, setProject] = useState(folder);
  const [profile, setProfile] = useState(
    state.profiles.find((p) => p.name === "dev-team")?.name ?? state.profiles[0]?.name ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  return (
    <main className="centred">
      <h1>agent-team</h1>
      <p>
        There's no <code>team.json</code> in <code>{state.projectDir}</code> yet. Pick a starting
        team; you can change everything afterwards.{" "}
        <button className="link" onClick={onChangeProject}>
          Use a different repository
        </button>
      </p>
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          onStart(profile, project.trim()).catch((err: Error) => setError(err.message));
        }}
      >
        <Field label="Project name">
          {(id) => <input id={id} value={project} onChange={(e) => setProject(e.target.value)} />}
        </Field>
        <fieldset className="profiles">
          <legend>Starting team</legend>
          {state.profiles.map((p) => (
            <label key={p.name} className="inline">
              <input
                type="radio"
                name="profile"
                value={p.name}
                checked={profile === p.name}
                onChange={() => setProfile(p.name)}
              />
              <strong>{p.name}</strong> <span className="muted">{p.description}</span>
            </label>
          ))}
        </fieldset>
        <button className="primary" type="submit" disabled={!project.trim() || !profile}>
          Create team
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </main>
  );
}
