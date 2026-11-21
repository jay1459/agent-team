import type {
  Profile,
  RoleDefinition,
  SpecialistDefinition,
  TeamConfigInput,
} from "@agent-team/schema";

export type CatalogRole = RoleDefinition & { team: boolean };

export type UiCatalog = {
  roles: CatalogRole[];
  specialists: SpecialistDefinition[];
  gates: string[];
  models: string[];
  tools: string[];
  maxTeamSize: number;
};

export type ProfileInfo = { name: string; description?: string; source: "user" | "built-in" };

export type UiState = {
  version: string;
  projectDir: string;
  configPath: string;
  exists: boolean;
  config: TeamConfigInput | null;
  errors: string[];
  catalog: UiCatalog;
  profiles: ProfileInfo[];
};

export type PreviewChange = {
  path: string;
  kind: "create" | "update" | "delete" | "unchanged";
  what: string;
  diff: string | null;
};

export type Preview = {
  agents: { name: string; title: string; model: string; kind: string }[];
  pmModel: string;
  warnings: string[];
  changes: PreviewChange[];
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly errors: string[],
    readonly status: number,
  ) {
    super(message);
  }
}

const TOKEN_KEY = "agent-team-token";

/** The CLI prints a link with #token=…; keep it for this tab and tidy the address bar. */
export function takeToken(): string | null {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get("token");
  if (fromHash) {
    sessionStorage.setItem(TOKEN_KEY, fromHash);
    history.replaceState(null, "", location.pathname + location.search);
  }
  return sessionStorage.getItem(TOKEN_KEY);
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${sessionStorage.getItem(TOKEN_KEY) ?? ""}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; errors?: string[] };
  if (!res.ok) throw new ApiError(data.error ?? res.statusText, data.errors ?? [], res.status);
  return data as T;
}

export const api = {
  state: () => call<UiState>("GET", "/api/state"),
  save: (config: TeamConfigInput) => call<{ ok: true }>("PUT", "/api/config", { config }),
  preview: (config: TeamConfigInput) => call<Preview>("POST", "/api/preview", { config }),
  apply: (config: TeamConfigInput) =>
    call<{ written: { path: string; kind: string }[]; warnings: string[] }>("POST", "/api/apply", {
      config,
    }),
  profiles: () => call<ProfileInfo[]>("GET", "/api/profiles"),
  profile: (name: string) => call<Profile>("GET", `/api/profiles/${encodeURIComponent(name)}`),
  saveProfile: (body: {
    name: string;
    description?: string;
    config: TeamConfigInput;
    overwrite: boolean;
  }) => call<{ ok: true; file: string }>("POST", "/api/profiles", body),
  deleteProfile: (name: string) =>
    call<{ ok: true }>("DELETE", `/api/profiles/${encodeURIComponent(name)}`),
};
