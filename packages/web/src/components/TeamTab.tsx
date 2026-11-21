import type { RoleConfig, RoleId, TeamConfigInput } from "@agent-team/schema";
import type { CatalogRole, UiCatalog } from "../api.ts";
import type { Edit } from "../App.tsx";
import { Field, FieldErrors, ModelSelect } from "./fields.tsx";

type Props = { draft: TeamConfigInput; edit: Edit; catalog: UiCatalog; errors: string[] };

export function TeamTab({ draft, edit, catalog, errors }: Props) {
  const teamDefault = draft.defaults?.model;
  return (
    <>
      <section className="panel">
        <h2>Project</h2>
        <div className="grid-2">
          <Field label="Project name">
            {(id) => (
              <input
                id={id}
                value={draft.project.name}
                onChange={(e) =>
                  edit((d) => {
                    d.project.name = e.target.value;
                  })
                }
              />
            )}
          </Field>
          <Field
            label="Default model"
            hint="Used by every agent that doesn't pick its own. Leave on 'Catalog defaults' to use each role's recommended model."
          >
            {(id) => (
              <ModelSelect
                id={id}
                value={teamDefault}
                models={catalog.models}
                defaultLabel="Catalog defaults"
                onChange={(model) =>
                  edit((d) => {
                    d.defaults = model ? { model } : {};
                  })
                }
              />
            )}
          </Field>
        </div>
        <Field label="Summary" hint="What the project is. The PM puts it at the top of the brief.">
          {(id) => (
            <textarea
              id={id}
              rows={2}
              value={draft.project.summary ?? ""}
              onChange={(e) =>
                edit((d) => {
                  if (e.target.value) d.project.summary = e.target.value;
                  else delete d.project.summary;
                })
              }
            />
          )}
        </Field>
        <FieldErrors errors={errors} path="project" />
        <FieldErrors errors={errors} path="defaults" />
      </section>

      <h2 className="section-title">Roles</h2>
      <div className="cards">
        {catalog.roles.map((role) => (
          <RoleCard
            key={role.id}
            role={role}
            config={draft.roles[role.id as RoleId]}
            teamDefault={teamDefault}
            catalog={catalog}
            errors={errors}
            edit={edit}
          />
        ))}
      </div>
    </>
  );
}

function RoleCard({
  role,
  config,
  teamDefault,
  catalog,
  errors,
  edit,
}: {
  role: CatalogRole;
  config: RoleConfig | undefined;
  teamDefault: string | undefined;
  catalog: UiCatalog;
  errors: string[];
  edit: Edit;
}) {
  const id = role.id as RoleId;
  const enabled = config?.enabled ?? false;
  const set = (change: (r: RoleConfig) => void) =>
    edit((d) => {
      const r = d.roles[id] ?? { enabled: false };
      change(r);
      d.roles[id] = r;
    });
  const defaultModel = teamDefault ?? role.defaultModel;
  const tools = config?.tools;

  return (
    <article className={`card ${enabled ? "on" : "off"}`} aria-label={role.title} data-role={id}>
      <header className="card-head">
        <label className="switch">
          <input
            type="checkbox"
            checked={enabled}
            disabled={role.mainSession && enabled}
            onChange={(e) => set((r) => void (r.enabled = e.target.checked))}
          />
          <span className="card-title">{role.title}</span>
        </label>
        {role.mainSession && <span className="pill">Leads the team</span>}
      </header>
      <p className="muted">{role.description}</p>

      {enabled && (
        <div className="card-body">
          <div className="grid-2">
            <Field label="Model">
              {(fid) => (
                <ModelSelect
                  id={fid}
                  value={config?.model}
                  models={catalog.models}
                  defaultLabel={`Default (${defaultModel})`}
                  onChange={(model) =>
                    set((r) => {
                      if (model) r.model = model;
                      else delete r.model;
                    })
                  }
                />
              )}
            </Field>
            {role.team && (
              <Field label="How many">
                {(fid) => (
                  <input
                    id={fid}
                    type="number"
                    min={1}
                    max={catalog.maxTeamSize}
                    value={config?.count ?? 1}
                    onChange={(e) =>
                      set((r) => {
                        const n = Number(e.target.value);
                        if (n <= 1) delete r.count;
                        else r.count = n;
                      })
                    }
                  />
                )}
              </Field>
            )}
          </div>

          {role.mainSession ? (
            <p className="hint">
              Runs as your Claude Code session when you type <code>/team</code>, so it can use every
              tool you allow.
            </p>
          ) : (
            <details>
              <summary>Tools: {(tools ?? role.tools).join(", ")}</summary>
              <label className="inline">
                <input
                  type="checkbox"
                  checked={tools !== undefined}
                  onChange={(e) =>
                    set((r) => {
                      if (e.target.checked) r.tools = [...role.tools];
                      else delete r.tools;
                    })
                  }
                />
                Choose tools for this role
              </label>
              {tools && (
                <div className="checks">
                  {catalog.tools.map((t) => (
                    <label key={t} className="inline">
                      <input
                        type="checkbox"
                        checked={tools.includes(t)}
                        onChange={(e) =>
                          set((r) => {
                            const now = new Set(r.tools ?? []);
                            if (e.target.checked) now.add(t);
                            else now.delete(t);
                            r.tools = catalog.tools
                              .filter((x) => now.has(x))
                              .concat([...now].filter((x) => !catalog.tools.includes(x)));
                          })
                        }
                      />
                      {t}
                    </label>
                  ))}
                </div>
              )}
            </details>
          )}

          <Field label="Extra instructions" hint="Added to the end of this role's prompt.">
            {(fid) => (
              <textarea
                id={fid}
                rows={2}
                value={config?.promptAppend ?? ""}
                placeholder="e.g. Use British English. Run tests with pnpm."
                onChange={(e) =>
                  set((r) => {
                    if (e.target.value) r.promptAppend = e.target.value;
                    else delete r.promptAppend;
                  })
                }
              />
            )}
          </Field>
          <details>
            <summary>View the catalog prompt</summary>
            <pre className="prompt">{role.prompt}</pre>
          </details>
        </div>
      )}
      <FieldErrors errors={errors} path={`roles.${id}`} />
    </article>
  );
}
