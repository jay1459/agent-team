import { teamConfigFromProfile, type TeamConfigInput } from "@agent-team/schema";
import { useState } from "react";
import { api, ApiError, type ProfileInfo } from "../api.ts";
import type { Notice } from "../App.tsx";
import { Field, slugify } from "./fields.tsx";

type Props = {
  draft: TeamConfigInput;
  setDraft: (d: TeamConfigInput) => void;
  profiles: ProfileInfo[];
  errors: string[];
  onChanged: () => Promise<void>;
  notify: (n: Notice) => void;
};

export function ProfilesTab({ draft, setDraft, profiles, errors, onChanged, notify }: Props) {
  const [name, setName] = useState(draft.extends ?? "");
  const [description, setDescription] = useState("");
  const exists = profiles.some((p) => p.name === name && p.source === "user");
  const fail = (err: unknown) =>
    notify({ kind: "error", text: (err as Error).message, details: (err as ApiError).errors });

  async function applyProfile(p: ProfileInfo) {
    if (
      !confirm(
        `Replace the team with the "${p.name}" profile? The project name, summary and secrets are kept.`,
      )
    )
      return;
    try {
      const profile = await api.profile(p.name);
      const next = teamConfigFromProfile(profile, draft.project) as TeamConfigInput;
      if (draft.secrets) next.secrets = draft.secrets;
      setDraft(next);
      notify({ kind: "ok", text: `Loaded the "${p.name}" profile. Save to keep it.` });
    } catch (err) {
      fail(err);
    }
  }

  async function save() {
    try {
      const res = await api.saveProfile({
        name,
        description: description || undefined,
        config: draft,
        overwrite: exists,
      });
      notify({ kind: "ok", text: `Saved profile "${name}" to ${res.file}.` });
      await onChanged();
    } catch (err) {
      fail(err);
    }
  }

  async function remove(p: ProfileInfo) {
    if (!confirm(`Delete your saved profile "${p.name}"?`)) return;
    try {
      await api.deleteProfile(p.name);
      await onChanged();
    } catch (err) {
      fail(err);
    }
  }

  return (
    <>
      <section className="panel">
        <h2>Start from a profile</h2>
        {draft.extends && (
          <p className="muted">
            This team was created from <strong>{draft.extends}</strong>.
          </p>
        )}
        <table className="table">
          <thead>
            <tr>
              <th>Profile</th>
              <th>Source</th>
              <th>Description</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.name}>
                <td>
                  <strong>{p.name}</strong>
                </td>
                <td>{p.source === "user" ? "Saved by you" : "Built in"}</td>
                <td className="muted">{p.description}</td>
                <td className="row-actions">
                  <button className="secondary" onClick={() => void applyProfile(p)}>
                    Use
                  </button>
                  {p.source === "user" && (
                    <button className="link danger-text" onClick={() => void remove(p)}>
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Save this team as a profile</h2>
        <p className="muted">
          Saves roles, specialists and workflow to ~/.agent-team/profiles so other projects can
          start from it.
        </p>
        <div className="grid-2">
          <Field label="Profile name">
            {(id) => (
              <input
                id={id}
                value={name}
                placeholder="my-team"
                onChange={(e) => setName(slugify(e.target.value))}
              />
            )}
          </Field>
          <Field label="Description">
            {(id) => (
              <input id={id} value={description} onChange={(e) => setDescription(e.target.value)} />
            )}
          </Field>
        </div>
        <button
          className="primary"
          disabled={!name || errors.length > 0}
          onClick={() => void save()}
        >
          {exists ? `Replace "${name}"` : "Save profile"}
        </button>
        {errors.length > 0 && <p className="hint">Fix the problems in the team first.</p>}
      </section>
    </>
  );
}
