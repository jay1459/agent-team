import type { TeamConfigInput } from "@agent-team/schema";
import { useState } from "react";
import type { UiCatalog } from "../api.ts";
import type { Edit } from "../App.tsx";
import { Field, FieldErrors, KeyValueEditor, ModelSelect, slugify } from "./fields.tsx";

type Props = { draft: TeamConfigInput; edit: Edit; catalog: UiCatalog; errors: string[] };
type SpecInput = NonNullable<TeamConfigInput["specialists"]>[number];

export function SpecialistsTab({ draft, edit, catalog, errors }: Props) {
  const specs = draft.specialists ?? [];
  const indexOf = (id: string) => specs.findIndex((s) => s.id === id);
  const teamDefault = draft.defaults?.model;

  const setSpec = (id: string, change: (s: SpecInput) => void) =>
    edit((d) => {
      d.specialists ??= [];
      let s = d.specialists.find((x) => x.id === id);
      if (!s) {
        s = { id, enabled: false };
        d.specialists.push(s);
      }
      change(s);
    });

  const custom = specs.map((s, i) => ({ s, i })).filter(({ s }) => s.id.startsWith("custom:"));

  return (
    <>
      <section className="panel">
        <h2>From the catalog</h2>
        {catalog.specialists.length === 0 ? (
          <p className="muted">No catalog specialists are installed. Add your own below.</p>
        ) : (
          <div className="cards">
            {catalog.specialists.map((def) => {
              const i = indexOf(def.id);
              const s = i >= 0 ? specs[i] : undefined;
              const on = s?.enabled ?? false;
              return (
                <article
                  key={def.id}
                  className={`card ${on ? "on" : "off"}`}
                  aria-label={def.title}
                  data-specialist={def.id}
                >
                  <header className="card-head">
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) =>
                          setSpec(def.id, (x) => void (x.enabled = e.target.checked))
                        }
                      />
                      <span className="card-title">{def.title}</span>
                    </label>
                    {def.mcp && <span className="pill">MCP</span>}
                  </header>
                  <p className="muted">{def.description}</p>
                  {on && (
                    <div className="card-body">
                      <Field label="Model">
                        {(id) => (
                          <ModelSelect
                            id={id}
                            value={s?.model}
                            models={catalog.models}
                            defaultLabel={`Default (${teamDefault ?? def.defaultModel})`}
                            onChange={(model) =>
                              setSpec(def.id, (x) => {
                                if (model) x.model = model;
                                else delete x.model;
                              })
                            }
                          />
                        )}
                      </Field>
                      {def.mcp && (
                        <label className="inline">
                          <input
                            type="checkbox"
                            checked={s?.mcp === true}
                            onChange={(e) =>
                              setSpec(def.id, (x) => {
                                if (e.target.checked) x.mcp = true;
                                else delete x.mcp;
                              })
                            }
                          />
                          Connect its MCP server (<code>{def.mcp.name}</code>)
                          {def.mcp.requires.length > 0 && (
                            <span className="muted"> · needs {def.mcp.requires.join(", ")}</span>
                          )}
                        </label>
                      )}
                      {def.mcp?.note && <p className="hint">{def.mcp.note}</p>}
                      <PromptAppend
                        value={s?.promptAppend}
                        onChange={(v) =>
                          setSpec(def.id, (x) => {
                            if (v) x.promptAppend = v;
                            else delete x.promptAppend;
                          })
                        }
                      />
                    </div>
                  )}
                  {i >= 0 && <FieldErrors errors={errors} path={`specialists.${i}`} />}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Your own specialists</h2>
        <p className="muted">
          For any service the catalog doesn't cover. Describe what it knows; the PM uses the
          description to decide when to bring it in.
        </p>
        <div className="cards">
          {custom.map(({ s, i }) => (
            <CustomSpecialist
              key={i}
              spec={s}
              index={i}
              catalog={catalog}
              teamDefault={teamDefault}
              errors={errors}
              edit={edit}
            />
          ))}
        </div>
        <AddCustom
          taken={specs.map((s) => s.id)}
          onAdd={(title, slug) =>
            edit((d) => {
              d.specialists ??= [];
              d.specialists.push({ id: `custom:${slug}`, enabled: true, title, description: "" });
            })
          }
        />
      </section>
    </>
  );
}

function PromptAppend({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  return (
    <Field label="Extra instructions">
      {(id) => (
        <textarea id={id} rows={2} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  );
}

function AddCustom({
  taken,
  onAdd,
}: {
  taken: string[];
  onAdd: (title: string, slug: string) => void;
}) {
  const [title, setTitle] = useState("");
  const slug = slugify(title);
  const clash = taken.includes(`custom:${slug}`);
  return (
    <form
      className="add-row"
      onSubmit={(e) => {
        e.preventDefault();
        if (!slug || clash) return;
        onAdd(title.trim(), slug);
        setTitle("");
      }}
    >
      <input
        aria-label="New specialist name"
        placeholder="Service name, e.g. Twilio"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <button className="secondary" type="submit" disabled={!slug || clash}>
        Add specialist
      </button>
      {clash && <span className="error small">You already have one called that.</span>}
    </form>
  );
}

type McpKind = "none" | "stdio" | "http";

function CustomSpecialist({
  spec,
  index,
  catalog,
  teamDefault,
  errors,
  edit,
}: {
  spec: SpecInput;
  index: number;
  catalog: UiCatalog;
  teamDefault: string | undefined;
  errors: string[];
  edit: Edit;
}) {
  const set = (change: (s: SpecInput) => void) =>
    edit((d) => {
      change(d.specialists![index]!);
    });
  const mcp = typeof spec.mcp === "object" ? spec.mcp : undefined;
  const kind: McpKind = !mcp ? "none" : "url" in mcp ? "http" : "stdio";

  return (
    <article
      className={`card ${spec.enabled ? "on" : "off"}`}
      aria-label={spec.title ?? spec.id}
      data-specialist={spec.id}
    >
      <header className="card-head">
        <label className="switch">
          <input
            type="checkbox"
            checked={spec.enabled}
            onChange={(e) => set((s) => void (s.enabled = e.target.checked))}
          />
          <span className="card-title">{spec.title || spec.id}</span>
        </label>
        <code className="muted small">{spec.id.slice("custom:".length)}-specialist</code>
      </header>
      <div className="card-body">
        <div className="grid-2">
          <Field label="Name">
            {(id) => (
              <input
                id={id}
                value={spec.title ?? ""}
                onChange={(e) => set((s) => void (s.title = e.target.value))}
              />
            )}
          </Field>
          <Field label="Model">
            {(id) => (
              <ModelSelect
                id={id}
                value={spec.model}
                models={catalog.models}
                defaultLabel={`Default (${teamDefault ?? "sonnet"})`}
                onChange={(model) =>
                  set((s) => {
                    if (model) s.model = model;
                    else delete s.model;
                  })
                }
              />
            )}
          </Field>
        </div>
        <Field
          label="What it knows"
          hint="Shown to the PM. Say what the service is and when this specialist should be used."
        >
          {(id) => (
            <textarea
              id={id}
              rows={2}
              value={spec.description ?? ""}
              onChange={(e) => set((s) => void (s.description = e.target.value))}
            />
          )}
        </Field>
        <Field
          label="Documentation links"
          hint="One URL per line. The specialist is told to check these first."
        >
          {(id) => (
            <textarea
              id={id}
              rows={2}
              value={(spec.docs ?? []).join("\n")}
              onChange={(e) =>
                set((s) => {
                  const docs = e.target.value.split("\n").map((l) => l.trim());
                  if (docs.some(Boolean)) s.docs = docs.filter(Boolean);
                  else delete s.docs;
                })
              }
            />
          )}
        </Field>
        <Field label="MCP server">
          {(id) => (
            <select
              id={id}
              value={kind}
              onChange={(e) =>
                set((s) => {
                  const k = e.target.value as McpKind;
                  if (k === "none") delete s.mcp;
                  else if (k === "stdio") s.mcp = { command: "" };
                  else s.mcp = { type: "http", url: "https://" };
                })
              }
            >
              <option value="none">None</option>
              <option value="stdio">Local command</option>
              <option value="http">Remote (HTTP)</option>
            </select>
          )}
        </Field>
        {mcp && "url" in mcp && (
          <>
            <Field label="URL">
              {(id) => (
                <input
                  id={id}
                  value={mcp.url}
                  onChange={(e) =>
                    set((s) => void ((s.mcp as { url: string }).url = e.target.value))
                  }
                />
              )}
            </Field>
            <div className="field">
              <span className="label">Headers</span>
              <KeyValueEditor
                value={mcp.headers ?? {}}
                onChange={(headers) =>
                  set((s) => void ((s.mcp as { headers?: object }).headers = headers))
                }
                keyLabel="Header name"
                valueLabel="Header value"
                keyPlaceholder="Authorization"
                valuePlaceholder="Bearer {env:MY_TOKEN}"
                addLabel="Add header"
              />
              <div className="hint">
                Values must point at environment variables, like Bearer {"{env:MY_TOKEN}"}.
              </div>
            </div>
          </>
        )}
        {mcp && "command" in mcp && (
          <>
            <div className="grid-2">
              <Field label="Command">
                {(id) => (
                  <input
                    id={id}
                    value={mcp.command}
                    placeholder="npx"
                    onChange={(e) =>
                      set((s) => void ((s.mcp as { command: string }).command = e.target.value))
                    }
                  />
                )}
              </Field>
              <Field label="Arguments" hint="Separated by spaces.">
                {(id) => (
                  <input
                    id={id}
                    value={(mcp.args ?? []).join(" ")}
                    placeholder="-y some-mcp-server"
                    onChange={(e) =>
                      set(
                        (s) =>
                          void ((s.mcp as { args?: string[] }).args = e.target.value
                            .split(" ")
                            .filter(Boolean)),
                      )
                    }
                  />
                )}
              </Field>
            </div>
            <div className="field">
              <span className="label">Environment</span>
              <KeyValueEditor
                value={mcp.env ?? {}}
                onChange={(env) => set((s) => void ((s.mcp as { env?: object }).env = env))}
                keyLabel="Variable the server reads"
                valueLabel="Your environment variable"
                keyPlaceholder="API_KEY"
                valuePlaceholder="env:MY_API_KEY"
                addLabel="Add variable"
              />
            </div>
          </>
        )}
        <PromptAppend
          value={spec.promptAppend}
          onChange={(v) =>
            set((s) => {
              if (v) s.promptAppend = v;
              else delete s.promptAppend;
            })
          }
        />
        <button
          className="danger"
          onClick={() =>
            edit((d) => {
              d.specialists!.splice(index, 1);
            })
          }
        >
          Remove {spec.title || "specialist"}
        </button>
      </div>
      <FieldErrors errors={errors} path={`specialists.${index}`} />
    </article>
  );
}
