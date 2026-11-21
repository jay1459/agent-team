import type { TeamConfigInput } from "@agent-team/schema";
import { useState } from "react";

type Props = { draft: TeamConfigInput; setDraft: (d: TeamConfigInput) => void; errors: string[] };

export function JsonTab({ draft, setDraft, errors }: Props) {
  const pretty = JSON.stringify(draft, null, 2);
  const [text, setText] = useState(pretty);
  const [parseError, setParseError] = useState<string | null>(null);
  const [synced, setSynced] = useState(pretty);

  // Follow edits made elsewhere (e.g. loading a profile), but don't reformat what's being typed here.
  if (pretty !== synced) {
    setSynced(pretty);
    if (!sameJson(text, draft)) {
      setText(pretty);
      setParseError(null);
    }
  }

  return (
    <section className="panel">
      <h2>team.json</h2>
      <p className="muted">Edit the config directly. Changes apply as soon as the JSON is valid.</p>
      <textarea
        aria-label="team.json"
        className="code"
        spellCheck={false}
        rows={28}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            setDraft(JSON.parse(e.target.value) as TeamConfigInput);
            setParseError(null);
          } catch (err) {
            setParseError((err as Error).message);
          }
        }}
      />
      {parseError && <p className="error">Not valid JSON yet: {parseError}</p>}
      {!parseError && errors.length > 0 && (
        <ul className="field-errors">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function sameJson(text: string, value: unknown): boolean {
  try {
    return JSON.stringify(JSON.parse(text)) === JSON.stringify(value);
  } catch {
    return false;
  }
}
