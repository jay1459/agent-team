import type { TeamConfigInput } from "@agent-team/schema";
import type { UiCatalog } from "../api.ts";
import type { Edit } from "../App.tsx";
import { Field, FieldErrors, KeyValueEditor } from "./fields.tsx";

const GATE_LABELS: Record<string, string> = {
  requirements: "Requirements: agree them before design starts",
  architecture: "Architecture: approve the design before building",
  estimate: "Estimates: before scope or estimates are shared",
  "customer-facing-docs": "Customer-facing documents: before anything is sent",
  merge: "Merge: before code goes into the main branch",
  release: "Release: before releasing or deploying",
};

type Props = { draft: TeamConfigInput; edit: Edit; catalog: UiCatalog; errors: string[] };

export function WorkflowTab({ draft, edit, catalog, errors }: Props) {
  const gates = draft.workflow?.humanApproval ?? ["architecture", "merge"];
  return (
    <>
      <section className="panel">
        <h2>Approval gates</h2>
        <p className="muted">The PM stops and asks you at each ticked point.</p>
        <div className="checks column">
          {catalog.gates.map((g) => (
            <label key={g} className="inline">
              <input
                type="checkbox"
                checked={gates.includes(g as never)}
                onChange={(e) =>
                  edit((d) => {
                    const now = new Set(d.workflow?.humanApproval ?? ["architecture", "merge"]);
                    if (e.target.checked) now.add(g as never);
                    else now.delete(g as never);
                    d.workflow = {
                      ...d.workflow,
                      humanApproval: catalog.gates.filter((x) => now.has(x as never)) as never,
                    };
                  })
                }
              />
              {GATE_LABELS[g] ?? g}
            </label>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Shared workspace</h2>
        <Field
          label="Folder"
          hint="Where the team keeps its brief, backlog, decisions and drafts, relative to the project."
        >
          {(id) => (
            <input
              id={id}
              value={draft.workflow?.workspace ?? "team/"}
              onChange={(e) =>
                edit((d) => {
                  d.workflow = { ...d.workflow, workspace: e.target.value };
                })
              }
            />
          )}
        </Field>
        <FieldErrors errors={errors} path="workflow" />
      </section>

      <section className="panel">
        <h2>Secrets</h2>
        <p className="muted">
          Names the agents may need, mapped to environment variables on your machine. Only
          references are stored, never values, so <code>team.json</code> is safe to commit.
        </p>
        <KeyValueEditor
          value={draft.secrets ?? {}}
          onChange={(secrets) =>
            edit((d) => {
              if (Object.keys(secrets).length) d.secrets = secrets;
              else delete d.secrets;
            })
          }
          keyLabel="Secret name"
          valueLabel="Environment variable"
          keyPlaceholder="AZURE_SUBSCRIPTION_ID"
          valuePlaceholder="env:AZURE_SUBSCRIPTION_ID"
          addLabel="Add secret"
        />
        <FieldErrors errors={errors} path="secrets" />
      </section>
    </>
  );
}
