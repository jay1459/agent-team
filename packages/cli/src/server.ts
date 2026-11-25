import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  APPROVAL_GATES,
  MODEL_ALIASES,
  parseProfile,
  parseTeamConfig,
  profileFromTeamConfig,
  ROLE_IDS,
  TEAM_ROLES,
  TOOL_NAMES,
  MAX_TEAM_SIZE,
} from "@agent-team/schema";
import type { Catalog } from "./catalog.js";
import { readConfigFile, writeConfigFile } from "./config-file.js";
import { generate, GenerateError } from "./generate.js";
import { applyPlan, diffChange, pendingChanges, planApply, PlanError } from "./plan.js";
import { deleteProfile, listProfiles, loadProfile, ProfileError, saveProfile } from "./profiles.js";
import { listRuns, readRun } from "./run/run-log.js";
import {
  defaultSessionDeps,
  SessionError,
  sessionStatus,
  startSession,
  stopSession,
  trustFolder,
  type SessionDeps,
  type SessionPermissionMode,
} from "./rc-session.js";
import {
  cloneProject,
  createProject,
  gitInfo,
  listProjects,
  openProject,
  projectProblem,
  ProjectError,
  type GithubVisibility,
} from "./project.js";

export type UiServerOptions = {
  /** The project to start on, or null to ask in the UI first. */
  projectDir: string | null;
  /** Config file for the starting project (defaults to <project>/team.json). */
  configPath?: string;
  /** Folder new projects are cloned or created in, and existing ones are opened from. */
  projectsRoot: string;
  /** Why the folder agent-team was started in can't be used, shown on the project screen. */
  startProblem?: string;
  /** tmux/claude access for Remote Control sessions; swapped out in tests. */
  sessionDeps?: SessionDeps;
  catalog: Catalog;
  host: string;
  port: number;
  /** Fixed token for tests; a random one otherwise. */
  token?: string;
  /** Folder with the built web UI. */
  webDir?: string;
  version: string;
};

export type UiServer = { server: Server; url: string; token: string; close: () => Promise<void> };

const MAX_BODY = 1024 * 1024;
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly errors?: string[],
  ) {
    super(message);
  }
}

/** The built UI ships next to dist/ in the npm package and in packages/web/dist during development. */
export function defaultWebDir(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  return [join(here, "../web"), join(here, "../../web/dist")].find((d) =>
    existsSync(join(d, "index.html")),
  );
}

export function isLoopback(host: string): boolean {
  return host === "localhost" || host === "::1" || /^127\./.test(host);
}

function send(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
    throw new HttpError(415, "Send JSON");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "Request too large");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Not valid JSON");
  }
}

function tokenMatches(req: IncomingMessage, token: string): boolean {
  const given = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function catalogForUi(catalog: Catalog) {
  return {
    roles: ROLE_IDS.filter((id) => catalog.roles.has(id)).map((id) => {
      const r = catalog.roles.get(id)!;
      return { ...r, team: TEAM_ROLES.includes(id) };
    }),
    specialists: [...catalog.specialists.values()],
    gates: APPROVAL_GATES,
    models: MODEL_ALIASES,
    tools: TOOL_NAMES,
    maxTeamSize: MAX_TEAM_SIZE,
  };
}

/** Validate and generate; throws HttpError(422) with readable errors when the config can't be used. */
function prepare(raw: unknown, catalog: Catalog) {
  const result = parseTeamConfig(raw);
  if (!result.ok) throw new HttpError(422, "The config has problems", result.errors);
  try {
    return { config: result.value, generated: generate(result.value, catalog) };
  } catch (err) {
    if (err instanceof GenerateError) throw new HttpError(422, err.message, [err.message]);
    throw err;
  }
}

function serveStatic(res: ServerResponse, webDir: string | undefined, urlPath: string) {
  if (!webDir) {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("The web UI hasn't been built. Run `npm run build` in the agent-team repo.");
    return;
  }
  const root = resolve(webDir);
  let file = resolve(root, `.${normalize(decodeURIComponent(urlPath))}`);
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(404).end();
    return;
  }
  // Single-page app: anything that isn't a file gets index.html.
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html");
  const type = MIME[extname(file)] ?? "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": file.endsWith("index.html")
      ? "no-store"
      : "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy":
      "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  });
  res.end(readFileSync(file));
}

export function createUiHandler(opts: UiServerOptions & { token: string }) {
  const { catalog, projectsRoot } = opts;
  let project: { dir: string; configPath: string } | null = opts.projectDir
    ? { dir: opts.projectDir, configPath: opts.configPath ?? join(opts.projectDir, "team.json") }
    : null;

  /** The current project; every config endpoint needs one. */
  const current = () => {
    if (!project) throw new HttpError(409, "Choose the project the team works in first.");
    const problem = projectProblem(project.dir);
    if (problem) throw new HttpError(409, problem);
    return project;
  };
  const switchTo = (dir: string) => {
    project = { dir, configPath: join(dir, "team.json") };
  };

  async function api(req: IncomingMessage, res: ServerResponse, path: string) {
    if (!tokenMatches(req, opts.token))
      throw new HttpError(401, "Missing or wrong token. Open the link the CLI printed.");
    const method = req.method ?? "GET";

    if (method === "GET" && path === "/api/state") {
      const problem = project ? projectProblem(project.dir) : null;
      const usable = project && !problem ? project : null;
      const file = usable ? readConfigFile(usable.configPath) : { exists: false as const };
      return send(res, 200, {
        version: opts.version,
        projectDir: usable?.dir ?? null,
        configPath: usable?.configPath ?? null,
        projectsRoot,
        projectProblem: problem ?? (project ? null : (opts.startProblem ?? null)),
        git: usable ? gitInfo(usable.dir) : null,
        exists: file.exists,
        config: file.exists ? file.raw : null,
        errors: file.exists && !file.result.ok ? file.result.errors : [],
        catalog: catalogForUi(catalog),
        profiles: listProfiles(catalog),
      });
    }

    // Choosing where the team works -----------------------------------------
    if (method === "GET" && path === "/api/projects")
      return send(res, 200, listProjects(projectsRoot));
    if (method === "POST" && path.startsWith("/api/project/")) {
      const body = (await readJson(req)) as {
        path?: string;
        init?: boolean;
        url?: string;
        name?: string;
        github?: GithubVisibility | null;
        description?: string;
      };
      let result;
      if (path === "/api/project/open")
        result = openProject(projectsRoot, body.path ?? "", { init: body.init ?? false });
      else if (path === "/api/project/clone")
        result = cloneProject(projectsRoot, body.url ?? "", body.name);
      else if (path === "/api/project/create") {
        if (body.github && body.github !== "private" && body.github !== "public") {
          throw new HttpError(400, 'github must be "private" or "public"');
        }
        result = createProject(projectsRoot, body.name ?? "", {
          ...(body.github ? { github: body.github } : {}),
          ...(body.description ? { description: body.description } : {}),
        });
      } else throw new HttpError(404, `No such endpoint: ${method} ${path}`);
      switchTo(result.dir);
      return send(res, 200, { dir: result.dir, git: result.git });
    }

    const { dir: projectDir, configPath } = current();

    // Remote Control session for the team -------------------------------------
    const sessionDeps = opts.sessionDeps ?? defaultSessionDeps();
    /** Whether the generated files match team.json (null when team.json can't be used). */
    const upToDate = () => {
      const file = readConfigFile(configPath);
      if (!file.exists || !file.result.ok) return null;
      try {
        return (
          pendingChanges(planApply(projectDir, generate(file.result.value, catalog))).length === 0
        );
      } catch {
        return null;
      }
    };
    if (method === "GET" && path === "/api/session") {
      return send(res, 200, { ...sessionStatus(projectDir, sessionDeps), upToDate: upToDate() });
    }
    if (method === "POST" && path === "/api/session/start") {
      const body = (await readJson(req)) as {
        goal?: string;
        name?: string;
        permissionMode?: SessionPermissionMode;
        apply?: boolean;
      };
      const file = readConfigFile(configPath);
      if (!file.exists || !file.result.ok) throw new HttpError(409, "Save a valid team first.");
      const plan = planApply(projectDir, prepare(file.raw, catalog).generated);
      if (pendingChanges(plan).length) {
        if (!body.apply)
          throw new HttpError(409, "The team's files are out of date. Apply them first.");
        applyPlan(plan);
      }
      const status = startSession(
        {
          projectDir,
          goal: body.goal ?? "",
          name: body.name ?? `${file.result.value.project.name} team`,
          ...(body.permissionMode ? { permissionMode: body.permissionMode } : {}),
        },
        sessionDeps,
      );
      return send(res, 200, { ...status, upToDate: true });
    }
    if (method === "POST" && path === "/api/session/trust") {
      return send(res, 200, { ...trustFolder(projectDir, sessionDeps), upToDate: upToDate() });
    }
    if (method === "POST" && path === "/api/session/stop") {
      return send(res, 200, { ...stopSession(projectDir, sessionDeps), upToDate: upToDate() });
    }

    if (method === "PUT" && path === "/api/config") {
      const { config } = (await readJson(req)) as { config?: unknown };
      prepare(config, catalog);
      writeConfigFile(configPath, config);
      return send(res, 200, { ok: true });
    }

    if (method === "POST" && path === "/api/preview") {
      const { config } = (await readJson(req)) as { config?: unknown };
      const { generated } = prepare(config, catalog);
      const plan = planApply(projectDir, generated);
      return send(res, 200, {
        agents: generated.agents,
        pmModel: generated.pmModel,
        warnings: plan.warnings,
        changes: plan.changes.map((c) => ({
          path: c.path,
          kind: c.kind,
          what: c.what,
          diff: c.kind === "unchanged" ? null : diffChange(c),
        })),
      });
    }

    if (method === "POST" && path === "/api/apply") {
      const { config } = (await readJson(req)) as { config?: unknown };
      const { generated } = prepare(config, catalog);
      writeConfigFile(configPath, config);
      const plan = planApply(projectDir, generated);
      const pending = pendingChanges(plan);
      applyPlan(plan);
      return send(res, 200, {
        written: pending.map((c) => ({ path: c.path, kind: c.kind })),
        warnings: plan.warnings,
      });
    }

    // Runs are started from the terminal (agent-team run); the UI only shows their logs.
    const workspaceDir = () => {
      const file = readConfigFile(configPath);
      const ws = file.exists && file.result.ok ? file.result.value.workflow.workspace : "team/";
      return join(projectDir, ws);
    };
    if (method === "GET" && path === "/api/runs") return send(res, 200, listRuns(workspaceDir()));
    const runMatch = /^\/api\/runs\/([0-9TZ-]+)$/.exec(path);
    if (method === "GET" && runMatch) {
      const events = readRun(workspaceDir(), runMatch[1]!);
      if (!events) throw new HttpError(404, "No such run");
      return send(res, 200, events);
    }

    const profileMatch = /^\/api\/profiles\/([a-z0-9-]+)$/.exec(path);
    if (method === "GET" && path === "/api/profiles") return send(res, 200, listProfiles(catalog));
    if (method === "GET" && profileMatch)
      return send(res, 200, loadProfile(profileMatch[1]!, catalog));
    if (method === "DELETE" && profileMatch) {
      deleteProfile(profileMatch[1]!);
      return send(res, 200, { ok: true });
    }
    if (method === "POST" && path === "/api/profiles") {
      const body = (await readJson(req)) as {
        name?: string;
        description?: string;
        config?: unknown;
        overwrite?: boolean;
      };
      const { config } = prepare(body.config, catalog);
      const profile = profileFromTeamConfig(config, body.name ?? "", body.description || undefined);
      const check = parseProfile(profile);
      if (!check.ok) throw new HttpError(422, "The profile has problems", check.errors);
      const file = saveProfile(profile, { overwrite: body.overwrite ?? false });
      return send(res, 200, { ok: true, file });
    }

    throw new HttpError(404, `No such endpoint: ${method} ${path}`);
  }

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname.startsWith("/api/")) {
        await api(req, res, url.pathname);
      } else if (req.method === "GET" || req.method === "HEAD") {
        serveStatic(res, opts.webDir, url.pathname);
      } else {
        throw new HttpError(405, "Method not allowed");
      }
    } catch (err) {
      if (err instanceof HttpError)
        return send(res, err.status, { error: err.message, errors: err.errors ?? [err.message] });
      if (err instanceof ProjectError)
        return send(res, 422, { error: err.message, errors: [err.message] });
      if (err instanceof ProfileError || err instanceof PlanError || err instanceof SessionError) {
        return send(res, 409, { error: err.message, errors: [err.message] });
      }
      send(res, 500, { error: "Something went wrong", errors: [(err as Error).message] });
    }
  };
}

export async function startUiServer(opts: UiServerOptions): Promise<UiServer> {
  const token = opts.token ?? randomBytes(24).toString("base64url");
  const server = createServer(
    createUiHandler({ ...opts, token, webDir: opts.webDir ?? defaultWebDir() }),
  );
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => resolveListen());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : opts.port;
  const shownHost = opts.host === "0.0.0.0" || opts.host === "::" ? "localhost" : opts.host;
  const url = `http://${shownHost.includes(":") ? `[${shownHost}]` : shownHost}:${port}/#token=${token}`;
  return {
    server,
    url,
    token,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
