import { z } from "zod";

export const CONFIG_VERSION = 1;

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

/** Aliases Claude Code resolves to the latest model in each family. */
export const MODEL_ALIASES = ["opus", "sonnet", "haiku", "inherit"] as const;

/**
 * A model alias (preferred: never goes stale) or a full model ID such as
 * "claude-sonnet-5-5" when a project needs to pin one.
 */
export const ModelSchema = z.union([
  z.enum(MODEL_ALIASES),
  z
    .string()
    .regex(/^claude-[a-z0-9][a-z0-9.-]*$/, 'Full model IDs start with "claude-"')
    .describe("Full model ID"),
]);
export type Model = z.infer<typeof ModelSchema>;

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lower-case letters, digits and single hyphens");

/** A secret is never stored in config, only a reference to an environment variable. */
export const EnvRefSchema = z
  .string()
  .regex(/^env:[A-Za-z_][A-Za-z0-9_]*$/, 'Secrets must be references like "env:MY_VAR"');

/** Claude Code tool names a subagent may be granted. */
export const TOOL_NAMES = [
  "Read",
  "Grep",
  "Glob",
  "Edit",
  "Write",
  "Bash",
  "WebFetch",
  "WebSearch",
  "NotebookEdit",
  "TodoWrite",
] as const;
export const ToolSchema = z.union([
  z.enum(TOOL_NAMES),
  z
    .string()
    .regex(/^mcp__[A-Za-z0-9_-]+(__[A-Za-z0-9_*-]+)?$/, "MCP tools look like mcp__server__tool"),
]);

export const McpServerSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), EnvRefSchema).default({}),
});
export type McpServer = z.infer<typeof McpServerSchema>;

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export const ROLE_IDS = ["pm", "architect", "lead-dev", "developer", "presales", "sales"] as const;
export const RoleIdSchema = z.enum(ROLE_IDS);
export type RoleId = z.infer<typeof RoleIdSchema>;

/** Roles that can be staffed by more than one agent. */
export const TEAM_ROLES: readonly RoleId[] = ["developer", "sales"];
export const MAX_TEAM_SIZE = 10;

export const RoleConfigSchema = z.object({
  enabled: z.boolean(),
  model: ModelSchema.optional(),
  /** Number of agents for team roles (developer, sales). */
  count: z.number().int().min(1).max(MAX_TEAM_SIZE).optional(),
  /** Extra instructions appended to the catalog prompt. */
  promptAppend: z.string().max(20_000).optional(),
  /** Replaces the catalog's tool list for this role. */
  tools: z.array(ToolSchema).optional(),
});
export type RoleConfig = z.infer<typeof RoleConfigSchema>;

// ---------------------------------------------------------------------------
// Specialists
// ---------------------------------------------------------------------------

export const SpecialistConfigSchema = z.object({
  /** A catalog id ("azure") or "custom:<slug>" for one you define here. */
  id: z.union([slug, z.string().regex(/^custom:[a-z0-9]+(-[a-z0-9]+)*$/, 'Use "custom:<slug>"')]),
  enabled: z.boolean(),
  model: ModelSchema.optional(),
  promptAppend: z.string().max(20_000).optional(),
  tools: z.array(ToolSchema).optional(),
  /** Custom specialists only: what it knows and when the PM should use it. */
  title: z.string().min(1).max(80).optional(),
  description: z.string().min(1).max(1_000).optional(),
  docs: z.array(z.url()).optional(),
  /** Wire up the catalog's MCP server (catalog specialists) or this one (custom). */
  mcp: z.union([z.boolean(), McpServerSchema]).optional(),
});
export type SpecialistConfig = z.infer<typeof SpecialistConfigSchema>;

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export const APPROVAL_GATES = [
  "requirements",
  "architecture",
  "estimate",
  "customer-facing-docs",
  "merge",
  "release",
] as const;

export const WorkflowSchema = z.object({
  /** Points where the PM stops and asks you before carrying on. */
  humanApproval: z.array(z.enum(APPROVAL_GATES)).default(["architecture", "merge"]),
  /** Shared folder for briefs, backlog, decisions and hand-offs, relative to the project. */
  workspace: z
    .string()
    .regex(
      /^(?!\/)(?!.*(^|\/)\.\.(\/|$))[A-Za-z0-9._/-]+\/?$/,
      "Use a relative path inside the project",
    )
    .default("team/"),
});
export type Workflow = z.infer<typeof WorkflowSchema>;

// ---------------------------------------------------------------------------
// Team body (shared by team.json and profiles)
// ---------------------------------------------------------------------------

const teamBody = {
  defaults: z.object({ model: ModelSchema.default("sonnet") }).default({ model: "sonnet" }),
  roles: z.partialRecord(RoleIdSchema, RoleConfigSchema),
  specialists: z.array(SpecialistConfigSchema).default([]),
  workflow: WorkflowSchema.default({
    humanApproval: ["architecture", "merge"],
    workspace: "team/",
  }),
};

type TeamBody = {
  roles: Partial<Record<RoleId, RoleConfig>>;
  specialists: SpecialistConfig[];
};

function checkTeamBody(team: TeamBody, ctx: z.RefinementCtx) {
  if (!team.roles.pm?.enabled) {
    ctx.addIssue({
      code: "custom",
      path: ["roles", "pm"],
      message: "The PM runs the team, so it must be enabled",
    });
  }
  for (const [id, role] of Object.entries(team.roles) as [RoleId, RoleConfig][]) {
    if (role.count !== undefined && !TEAM_ROLES.includes(id)) {
      ctx.addIssue({
        code: "custom",
        path: ["roles", id, "count"],
        message: `Only ${TEAM_ROLES.join(" and ")} can have more than one agent`,
      });
    }
  }
  const seen = new Set<string>();
  team.specialists.forEach((s, i) => {
    if (seen.has(s.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["specialists", i, "id"],
        message: `Duplicate specialist "${s.id}"`,
      });
    }
    seen.add(s.id);
    const custom = s.id.startsWith("custom:");
    if (custom && (!s.title || !s.description)) {
      ctx.addIssue({
        code: "custom",
        path: ["specialists", i],
        message: "Custom specialists need a title and a description",
      });
    }
    if (custom && s.mcp === true) {
      ctx.addIssue({
        code: "custom",
        path: ["specialists", i, "mcp"],
        message: "Custom specialists must spell out their MCP server (command, args, env)",
      });
    }
  });
}

// ---------------------------------------------------------------------------
// team.json and profiles
// ---------------------------------------------------------------------------

export const TeamConfigSchema = z
  .object({
    $schema: z.string().optional(),
    version: z.literal(CONFIG_VERSION),
    /** Name of the profile this config was created from, if any. */
    extends: slug.optional(),
    project: z.object({
      name: z.string().min(1).max(120),
      summary: z.string().max(5_000).optional(),
    }),
    ...teamBody,
    /** Names the agents may need, mapped to environment variables. Never literal values. */
    secrets: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), EnvRefSchema).default({}),
  })
  .strict()
  .superRefine(checkTeamBody);
export type TeamConfig = z.infer<typeof TeamConfigSchema>;
export type TeamConfigInput = z.input<typeof TeamConfigSchema>;

export const ProfileSchema = z
  .object({
    $schema: z.string().optional(),
    version: z.literal(CONFIG_VERSION),
    name: slug,
    description: z.string().max(1_000).optional(),
    ...teamBody,
  })
  .strict()
  .superRefine(checkTeamBody);
export type Profile = z.infer<typeof ProfileSchema>;

// ---------------------------------------------------------------------------
// Catalog entries (catalog/roles/*.md frontmatter; the markdown body is the prompt)
// ---------------------------------------------------------------------------

export const RoleDefinitionSchema = z
  .object({
    id: RoleIdSchema,
    title: z.string().min(1),
    /** Shown to the PM: what this agent does and when to hand it work. */
    description: z.string().min(20).max(1_000),
    defaultModel: ModelSchema,
    /** Tools granted to the subagent. The PM runs as the main session, so it has none listed. */
    tools: z.array(ToolSchema),
    mainSession: z.boolean().default(false),
    prompt: z.string().min(50),
  })
  .strict()
  .superRefine((role, ctx) => {
    if ((role.id === "pm") !== role.mainSession) {
      ctx.addIssue({
        code: "custom",
        path: ["mainSession"],
        message: "Only the PM runs as the main session",
      });
    }
  });
export type RoleDefinition = z.infer<typeof RoleDefinitionSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function toResult<T>(result: z.ZodSafeParseResult<T>): ParseResult<T> {
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((issue) => {
      const where = issue.path.length ? issue.path.join(".") : "(root)";
      return `${where}: ${issue.message}`;
    }),
  };
}

/** Validate a parsed team.json, returning readable "path: message" errors. */
export function parseTeamConfig(input: unknown): ParseResult<TeamConfig> {
  return toResult(TeamConfigSchema.safeParse(input));
}

export function parseProfile(input: unknown): ParseResult<Profile> {
  return toResult(ProfileSchema.safeParse(input));
}

export function parseRoleDefinition(input: unknown): ParseResult<RoleDefinition> {
  return toResult(RoleDefinitionSchema.safeParse(input));
}

/** The model an agent runs on: its own setting, else the team default, else the catalog default. */
export function resolveModel(
  own: Model | undefined,
  teamDefault: Model | undefined,
  catalogDefault: Model,
): Model {
  return own ?? teamDefault ?? catalogDefault;
}

/** Start a project's team.json from a profile. */
export function teamConfigFromProfile(
  profile: Profile,
  project: TeamConfig["project"],
): TeamConfig {
  const { name, defaults, roles, specialists, workflow } = profile;
  return structuredClone({
    version: CONFIG_VERSION,
    extends: name,
    project,
    defaults,
    roles,
    specialists,
    workflow,
    secrets: {},
  });
}

/** Save a project's team as a reusable profile. */
export function profileFromTeamConfig(
  config: TeamConfig,
  name: string,
  description?: string,
): Profile {
  const { defaults, roles, specialists, workflow } = config;
  return structuredClone({
    version: CONFIG_VERSION,
    name,
    ...(description ? { description } : {}),
    defaults,
    roles,
    specialists,
    workflow,
  });
}

export const JSON_SCHEMA_IDS = {
  team: "https://raw.githubusercontent.com/jay1459/agent-team/main/schemas/team.schema.json",
  profile: "https://raw.githubusercontent.com/jay1459/agent-team/main/schemas/profile.schema.json",
} as const;

/** JSON Schema documents for editors (validated by the "$schema" key in team.json). */
export function jsonSchemas() {
  const opts = { io: "input", unrepresentable: "any" } as const;
  return {
    team: { $id: JSON_SCHEMA_IDS.team, ...z.toJSONSchema(TeamConfigSchema, opts) },
    profile: { $id: JSON_SCHEMA_IDS.profile, ...z.toJSONSchema(ProfileSchema, opts) },
  };
}
