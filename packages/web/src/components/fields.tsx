import { useId, useState, type ReactNode } from "react";
import { errorsUnder } from "../util.ts";

export function FieldErrors({ errors, path }: { errors: string[]; path: string }) {
  const mine = errorsUnder(errors, path);
  if (!mine.length) return null;
  return (
    <ul className="field-errors" role="alert">
      {mine.map((e) => (
        <li key={e}>{e.slice(e.indexOf(": ") + 2)}</li>
      ))}
    </ul>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

const CUSTOM = "__custom__";

/**
 * Model picker: "default" (empty), an alias, or a full model ID.
 * `defaultLabel` says what the default resolves to.
 */
export function ModelSelect({
  id,
  value,
  onChange,
  models,
  defaultLabel,
  allowDefault = true,
}: {
  id?: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  models: string[];
  defaultLabel: string;
  allowDefault?: boolean;
}) {
  const isCustom = value !== undefined && !models.includes(value);
  const [customOpen, setCustomOpen] = useState(isCustom);
  const selectValue = customOpen || isCustom ? CUSTOM : (value ?? "");
  return (
    <div className="model-select">
      <select
        id={id}
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === CUSTOM) {
            setCustomOpen(true);
            onChange(value && !models.includes(value) ? value : "claude-");
          } else {
            setCustomOpen(false);
            onChange(v === "" ? undefined : v);
          }
        }}
      >
        {allowDefault && <option value="">{defaultLabel}</option>}
        {models.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
        <option value={CUSTOM}>Full model ID…</option>
      </select>
      {selectValue === CUSTOM && (
        <input
          aria-label="Full model ID"
          value={value ?? ""}
          placeholder="claude-sonnet-5-5"
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

/** Editable list of NAME → value rows. */
export function KeyValueEditor({
  value,
  onChange,
  keyLabel,
  valueLabel,
  keyPlaceholder,
  valuePlaceholder,
  addLabel,
}: {
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  keyLabel: string;
  valueLabel: string;
  keyPlaceholder: string;
  valuePlaceholder: string;
  addLabel: string;
}) {
  // Rows are kept as an array so a half-typed or duplicate key doesn't lose data while editing.
  const [rows, setRows] = useState(() => Object.entries(value));
  const commit = (next: [string, string][]) => {
    setRows(next);
    onChange(Object.fromEntries(next.filter(([k]) => k.trim() !== "")));
  };
  return (
    <div className="kv">
      {rows.map(([k, v], i) => (
        <div className="kv-row" key={i}>
          <input
            aria-label={keyLabel}
            placeholder={keyPlaceholder}
            value={k}
            onChange={(e) => commit(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))}
          />
          <span aria-hidden>→</span>
          <input
            aria-label={valueLabel}
            placeholder={valuePlaceholder}
            value={v}
            onChange={(e) => commit(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))}
          />
          <button
            className="link"
            aria-label={`Remove ${k || "row"}`}
            onClick={() => commit(rows.filter((_, j) => j !== i))}
          >
            Remove
          </button>
        </div>
      ))}
      <button className="secondary" onClick={() => setRows([...rows, ["", ""]])}>
        {addLabel}
      </button>
    </div>
  );
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
