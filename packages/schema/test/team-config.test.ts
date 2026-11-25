import { describe, expect, it } from "vitest";
import {
  parseProfile,
  parseTeamConfig,
  profileFromTeamConfig,
  resolveModel,
  teamConfigFromProfile,
  type TeamConfigInput,
} from "../src/index.js";

const minimal = (): TeamConfigInput => ({
  version: 1,
  project: { name: "Test" },
  roles: { pm: { enabled: true } },
});

function errorsFor(input: unknown): string[] {
  const result = parseTeamConfig(input);
  if (result.ok) throw new Error("expected the config to be rejected");
  return result.errors;
}

describe("team.json", () => {
  it("accepts a minimal config and fills in defaults", () => {
    const result = parseTeamConfig(minimal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.defaults).toEqual({});
    expect(result.value.specialists).toEqual([]);
    expect(result.value.workflow).toEqual({
      humanApproval: ["architecture", "merge"],
      workspace: "team/",
    });
    expect(result.value.secrets).toEqual({});
  });

  it("accepts model aliases and full model IDs", () => {
    for (const model of ["opus", "sonnet", "haiku", "inherit", "claude-sonnet-5-5"]) {
      expect(parseTeamConfig({ ...minimal(), defaults: { model } }).ok).toBe(true);
    }
  });

  it("rejects unknown models", () => {
    expect(errorsFor({ ...minimal(), defaults: { model: "gpt-5" } })).toEqual([
      expect.stringMatching(/^defaults\.model:/),
    ]);
  });

  it("requires the PM to be enabled", () => {
    expect(errorsFor({ ...minimal(), roles: { pm: { enabled: false } } })).toEqual([
      "roles.pm: The PM runs the team, so it must be enabled",
    ]);
    expect(errorsFor({ ...minimal(), roles: { developer: { enabled: true } } })).toEqual([
      "roles.pm: The PM runs the team, so it must be enabled",
    ]);
  });

  it("rejects unknown roles and unknown top-level keys", () => {
    expect(
      errorsFor({ ...minimal(), roles: { pm: { enabled: true }, cto: { enabled: true } } }),
    ).not.toEqual([]);
    expect(errorsFor({ ...minimal(), apiKey: "sk-123" })).not.toEqual([]);
  });

  it("only lets team roles have a count, within limits", () => {
    const withRoles = (roles: object) => ({
      ...minimal(),
      roles: { pm: { enabled: true }, ...roles },
    });
    expect(parseTeamConfig(withRoles({ developer: { enabled: true, count: 4 } })).ok).toBe(true);
    expect(parseTeamConfig(withRoles({ sales: { enabled: true, count: 2 } })).ok).toBe(true);
    expect(errorsFor(withRoles({ architect: { enabled: true, count: 2 } }))).toEqual([
      "roles.architect.count: Only developer, qa, uat-tester and sales can have more than one agent",
    ]);
    expect(errorsFor(withRoles({ developer: { enabled: true, count: 0 } }))).not.toEqual([]);
    expect(errorsFor(withRoles({ developer: { enabled: true, count: 11 } }))).not.toEqual([]);
  });

  it("lets team roles leave the number of agents to the PM", () => {
    const withRoles = (roles: object) => ({
      ...minimal(),
      roles: { pm: { enabled: true }, ...roles },
    });
    for (const id of ["developer", "qa", "uat-tester", "sales"]) {
      expect(
        parseTeamConfig(withRoles({ [id]: { enabled: true, count: "pm-decides" } })).ok,
        id,
      ).toBe(true);
    }
    expect(errorsFor(withRoles({ security: { enabled: true, count: "pm-decides" } }))).toEqual([
      "roles.security.count: Only developer, qa, uat-tester and sales can have more than one agent",
    ]);
    expect(errorsFor(withRoles({ developer: { enabled: true, count: "lots" } }))).not.toEqual([]);
  });

  it("accepts shareable repository addresses only", () => {
    const withRepo = (repository: string) => ({ ...minimal(), project: { name: "X", repository } });
    expect(parseTeamConfig(withRepo("https://github.com/a/b.git")).ok).toBe(true);
    expect(parseTeamConfig(withRepo("git@github.com:a/b.git")).ok).toBe(true);
    expect(errorsFor(withRepo("/home/me/code"))).not.toEqual([]);
  });

  it("checks tool names", () => {
    const withTools = (tools: string[]) => ({
      ...minimal(),
      roles: { pm: { enabled: true }, developer: { enabled: true, tools } },
    });
    expect(parseTeamConfig(withTools(["Read", "Bash", "mcp__azure__list_resources"])).ok).toBe(
      true,
    );
    expect(errorsFor(withTools(["Telepathy"]))).not.toEqual([]);
  });

  it("only allows environment-variable references as secrets", () => {
    expect(parseTeamConfig({ ...minimal(), secrets: { API_KEY: "env:MY_API_KEY" } }).ok).toBe(true);
    expect(errorsFor({ ...minimal(), secrets: { API_KEY: "sk-live-123" } })).toEqual([
      'secrets.API_KEY: Secrets must be references like "env:MY_VAR"',
    ]);
  });

  it("validates specialists", () => {
    const withSpecialists = (specialists: object[]) => ({ ...minimal(), specialists });
    expect(parseTeamConfig(withSpecialists([{ id: "azure", enabled: true, mcp: true }])).ok).toBe(
      true,
    );
    expect(
      parseTeamConfig(
        withSpecialists([
          {
            id: "custom:twilio",
            enabled: true,
            title: "Twilio",
            description: "Messaging",
            mcp: {
              command: "npx",
              args: ["-y", "twilio-mcp"],
              env: { TWILIO_TOKEN: "env:TWILIO_TOKEN" },
            },
          },
        ]),
      ).ok,
    ).toBe(true);

    expect(
      errorsFor(
        withSpecialists([
          { id: "azure", enabled: true },
          { id: "azure", enabled: false },
        ]),
      ),
    ).toEqual(['specialists.1.id: Duplicate specialist "azure"']);
    expect(errorsFor(withSpecialists([{ id: "custom:twilio", enabled: true }]))).toEqual([
      "specialists.0: Custom specialists need a title and a description",
    ]);
    expect(
      errorsFor(
        withSpecialists([
          { id: "custom:x", enabled: true, title: "X", description: "X", mcp: true },
        ]),
      ),
    ).toEqual([
      "specialists.0.mcp: Custom specialists must spell out their MCP server (command, args, env)",
    ]);
    expect(errorsFor(withSpecialists([{ id: "Azure Cloud", enabled: true }]))).not.toEqual([]);
    expect(
      errorsFor(
        withSpecialists([
          {
            id: "custom:x",
            enabled: true,
            title: "X",
            description: "X",
            mcp: { command: "x", env: { T: "secret" } },
          },
        ]),
      ),
    ).not.toEqual([]);
  });

  it("accepts remote MCP servers whose headers only reference environment variables", () => {
    const withMcp = (mcp: object) => ({
      ...minimal(),
      specialists: [
        { id: "custom:gh", enabled: true, title: "GitHub", description: "GitHub", mcp },
      ],
    });
    const http = { type: "http", url: "https://api.example.com/mcp" };
    expect(parseTeamConfig(withMcp(http)).ok).toBe(true);
    expect(
      parseTeamConfig(withMcp({ ...http, headers: { Authorization: "Bearer {env:GH_TOKEN}" } })).ok,
    ).toBe(true);
    expect(parseTeamConfig(withMcp({ ...http, headers: { "X-Key": "{env:KEY}" } })).ok).toBe(true);
    expect(
      parseTeamConfig(withMcp({ ...http, headers: { Authorization: "Bearer ghp_123" } })).ok,
    ).toBe(false);
    expect(parseTeamConfig(withMcp({ ...http, url: "file:///etc/passwd" })).ok).toBe(false);
    expect(parseTeamConfig(withMcp({ ...http, command: "npx" })).ok).toBe(false);
  });

  it("keeps the workspace inside the project", () => {
    const withWorkspace = (workspace: string) => ({ ...minimal(), workflow: { workspace } });
    expect(parseTeamConfig(withWorkspace("team/")).ok).toBe(true);
    expect(parseTeamConfig(withWorkspace("docs/agents")).ok).toBe(true);
    for (const bad of ["/etc/", "../outside", "team/../../x", ".."]) {
      expect(parseTeamConfig(withWorkspace(bad)).ok, bad).toBe(false);
    }
  });

  it("has runner defaults and checks layered teams have a lead developer and developers", () => {
    const parsed = parseTeamConfig(minimal());
    expect(parsed.ok && parsed.value.runner).toEqual({
      layered: false,
      permissionMode: "acceptEdits",
    });
    expect(errorsFor({ ...minimal(), runner: { layered: true } })).toEqual([
      "runner.layered: A layered team needs both the lead developer and developers switched on",
    ]);
    const layered = {
      ...minimal(),
      roles: { pm: { enabled: true }, "lead-dev": { enabled: true }, developer: { enabled: true } },
      runner: { layered: true, maxBudgetUsd: 20, teamBudgetUsd: 5, permissionMode: "default" },
    };
    expect(parseTeamConfig(layered).ok).toBe(true);
    expect(errorsFor({ ...minimal(), runner: { maxBudgetUsd: 0 } })).not.toEqual([]);
    expect(
      errorsFor({ ...minimal(), runner: { permissionMode: "bypassPermissions" } }),
    ).not.toEqual([]);
  });

  it("rejects unknown approval gates", () => {
    expect(errorsFor({ ...minimal(), workflow: { humanApproval: ["vibes"] } })).not.toEqual([]);
  });
});

describe("resolveModel", () => {
  it("prefers the agent's own model, then the team default, then the catalog", () => {
    expect(resolveModel("haiku", "sonnet", "opus")).toBe("haiku");
    expect(resolveModel(undefined, "sonnet", "opus")).toBe("sonnet");
    expect(resolveModel(undefined, undefined, "opus")).toBe("opus");
  });
});

describe("profiles", () => {
  const profileInput = {
    version: 1,
    name: "consultancy",
    description: "Full delivery team",
    roles: { pm: { enabled: true, model: "opus" }, developer: { enabled: true, count: 2 } },
    specialists: [{ id: "azure", enabled: true }],
  };

  it("accepts a profile and rejects project-specific keys", () => {
    expect(parseProfile(profileInput).ok).toBe(true);
    expect(parseProfile({ ...profileInput, project: { name: "x" } }).ok).toBe(false);
    expect(parseProfile({ ...profileInput, secrets: {} }).ok).toBe(false);
    expect(parseProfile({ ...profileInput, name: "My Profile" }).ok).toBe(false);
  });

  it("round-trips between a profile and a project config", () => {
    const profile = parseProfile(profileInput);
    if (!profile.ok) throw new Error(profile.errors.join("\n"));

    const config = teamConfigFromProfile(profile.value, { name: "Contoso" });
    expect(config.extends).toBe("consultancy");
    expect(parseTeamConfig(config).ok).toBe(true);

    // Editing the project must not change the profile it came from.
    config.roles.developer!.count = 5;
    expect(profile.value.roles.developer!.count).toBe(2);

    const saved = profileFromTeamConfig(config, "consultancy-large");
    expect(parseProfile(saved).ok).toBe(true);
    expect(saved.roles.developer!.count).toBe(5);
    expect(saved).not.toHaveProperty("project");
    expect(saved).not.toHaveProperty("secrets");
  });
});
