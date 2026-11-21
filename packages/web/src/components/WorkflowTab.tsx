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
        <h2>Unattended runs</h2>
        <p className="muted">
          For <code>agent-team run</code>, which runs the team on the Claude Agent SDK without you
          in a chat. Runs are billed, so set a budget.
        </p>
        <label className="inline">
          <input
            type="checkbox"
            checked={draft.runner?.layered ?? false}
            onChange={(e) =>
              edit((d) => {
                d.runner = { ...d.runner, layered: e.target.checked };
              })
            }
          />
          Layered team: the lead developer directs the developers, and the PM hands build work to
          the lead developer
        </label>
        <div className="grid-2">
          <Field
            label="Budget per run (USD)"
            hint="The PM's session stops once it has spent this much."
          >
            {(id) => (
              <input
                id={id}
                type="number"
                min={0}
                step={0.5}
                value={draft.runner?.maxBudgetUsd ?? ""}
                placeholder="No limit"
                onChange={(e) =>
                  edit((d) => {
                    const runner = { ...d.runner };
                    if (e.target.value === "") delete runner.maxBudgetUsd;
                    else runner.maxBudgetUsd = Number(e.target.value);
                    d.runner = runner;
                  })
                }
              />
            )}
          </Field>
          <Field
            label="Budget per team hand-off (USD)"
            hint="Layered runs: caps each task the lead developer's team takes on."
          >
            {(id) => (
              <input
                id={id}
                type="number"
                min={0}
                step={0.5}
                value={draft.runner?.teamBudgetUsd ?? ""}
                placeholder="No limit"
                onChange={(e) =>
                  edit((d) => {
                    const runner = { ...d.runner };
                    if (e.target.value === "") delete runner.teamBudgetUsd;
                    else runner.teamBudgetUsd = Number(e.target.value);
                    d.runner = runner;
                  })
                }
              />
            )}
          </Field>
        </div>
        <Field
          label="Permissions"
          hint="Anything not allowed here is asked about in the terminal (or refused when nobody can answer)."
        >
          {(id) => (
            <select
              id={id}
              value={draft.runner?.permissionMode ?? "acceptEdits"}
              onChange={(e) =>
                edit((d) => {
                  d.runner = {
                    ...d.runner,
                    permissionMode: e.target.value as "default" | "acceptEdits" | "plan",
                  };
                })
              }
            >
              <option value="acceptEdits">Agents may edit files; ask before commands</option>
              <option value="default">Ask before edits and commands</option>
              <option value="plan">Plan only: no changes</option>
            </select>
          )}
        </Field>
        <FieldErrors errors={errors} path="runner" />
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
