import { describe, expect, it } from "vitest";
import { envVarsIn, generate, GenerateError, render, toMcpJson } from "../src/generate.js";
import { catalog, config, exampleConfig } from "./helpers.js";

describe("generate", () => {
  it("matches the snapshot for the consultancy example", async () => {
    const out = generate(exampleConfig("consultancy"), catalog);
    for (const file of out.files) {
      await expect(file.content).toMatchFileSnapshot(`__snapshots__/consultancy/${file.path}`);
    }
    await expect(out.claudeSection).toMatchFileSnapshot(
      "__snapshots__/consultancy/CLAUDE-section.md",
    );
    await expect(`${JSON.stringify(out.mcpServers, null, 2)}\n`).toMatchFileSnapshot(
      "__snapshots__/consultancy/mcp-servers.json",
    );
  });

  it("only generates agents for enabled roles, and never one for the PM", () => {
    const out = generate(
      config({
        roles: { pm: { enabled: true }, architect: { enabled: true }, sales: { enabled: false } },
      }),
      catalog,
    );
    expect(out.agents.map((a) => a.name)).toEqual(["architect"]);
    expect(out.files.map((f) => f.path)).toEqual([
      ".claude/agents/architect.md",
      ".claude/commands/team.md",
    ]);
  });

  it("numbers team roles when there is more than one", () => {
    const names = (count?: number) =>
      generate(
        config({ roles: { pm: { enabled: true }, developer: { enabled: true, count } } }),
        catalog,
      ).agents.map((a) => a.name);
    expect(names()).toEqual(["developer"]);
    expect(names(1)).toEqual(["developer"]);
    expect(names(3)).toEqual(["developer-1", "developer-2", "developer-3"]);
  });

  it("resolves models: agent, then team default, then catalog", () => {
    const models = (input: Parameters<typeof config>[0]) =>
      Object.fromEntries(generate(config(input), catalog).agents.map((a) => [a.name, a.model]));
    const roles = { pm: { enabled: true }, architect: { enabled: true }, sales: { enabled: true } };
    expect(models({ roles })).toEqual({ architect: "opus", sales: "haiku" });
    expect(models({ roles, defaults: { model: "sonnet" } })).toEqual({
      architect: "sonnet",
      sales: "sonnet",
    });
    expect(
      models({
        roles: { ...roles, sales: { enabled: true, model: "claude-haiku-5-5" } },
        defaults: { model: "sonnet" },
      }),
    ).toEqual({ architect: "sonnet", sales: "claude-haiku-5-5" });
  });

  it("puts the PM model on the /team command, or leaves it out for inherit", () => {
    const command = (model?: string) =>
      generate(config({ roles: { pm: { enabled: true, model } } }), catalog).files.find(
        (f) => f.path === ".claude/commands/team.md",
      )!.content;
    expect(command()).toContain("model: opus");
    expect(command("sonnet")).toContain("model: sonnet");
    expect(command("inherit")).not.toContain("model:");
  });

  it("applies tool overrides and appended instructions", () => {
    const out = generate(
      config({
        roles: {
          pm: { enabled: true, promptAppend: "Report in British English." },
          developer: { enabled: true, tools: ["Read", "Edit"], promptAppend: "Use pnpm, not npm." },
        },
      }),
      catalog,
    );
    const dev = out.files.find((f) => f.path === ".claude/agents/developer.md")!.content;
    expect(dev).toContain("tools: Read, Edit\n");
    expect(dev).toContain("## Project-specific instructions\n\nUse pnpm, not npm.");
    expect(out.claudeSection).toContain("Report in British English.");
  });

  it("describes the roster and approval gates for the PM", () => {
    const out = generate(
      config({
        roles: { pm: { enabled: true }, architect: { enabled: true } },
        workflow: { humanApproval: ["release"], workspace: "docs/team" },
      }),
      catalog,
    );
    expect(out.claudeSection).toContain("| `architect` | Architect | opus |");
    expect(out.claudeSection).toContain("release (releasing or deploying)");
    expect(out.claudeSection).toContain("`docs/team/backlog.md`");
    expect(out.workspace.map((f) => f.path)).toEqual([
      "docs/team/brief.md",
      "docs/team/backlog.md",
      "docs/team/decisions/README.md",
    ]);

    const solo = generate(config({ workflow: { humanApproval: [] } }), catalog);
    expect(solo.claudeSection).toContain("No other agents are switched on");
    expect(solo.claudeSection).toContain("nothing: carry on without stopping");
  });

  it("builds custom specialists, including their MCP server", () => {
    const out = generate(
      config({
        specialists: [
          {
            id: "custom:twilio",
            enabled: true,
            title: "Twilio",
            description: "SMS and WhatsApp via Twilio.",
            docs: ["https://www.twilio.com/docs"],
            mcp: {
              command: "npx",
              args: ["-y", "twilio-mcp"],
              env: { TWILIO_TOKEN: "env:MY_TWILIO_TOKEN" },
            },
          },
          { id: "custom:off", enabled: false, title: "Off", description: "Disabled." },
        ],
      }),
      catalog,
    );
    expect(out.agents).toEqual([
      {
        name: "twilio-specialist",
        title: "Twilio specialist",
        model: "sonnet",
        description: "SMS and WhatsApp via Twilio.",
        kind: "specialist",
        tools: ["Read", "Grep", "Glob", "Write", "Edit", "WebFetch", "WebSearch", "mcp__twilio"],
      },
    ]);
    const file = out.files.find((f) => f.path === ".claude/agents/twilio-specialist.md")!.content;
    expect(file).toContain("You are the Twilio specialist on Test project.");
    expect(file).toContain("  - https://www.twilio.com/docs");
    expect(file).not.toMatch(/\n{3,}/);
    expect(out.mcpServers).toEqual({
      twilio: {
        type: "stdio",
        command: "npx",
        args: ["-y", "twilio-mcp"],
        env: { TWILIO_TOKEN: "${MY_TWILIO_TOKEN}" },
      },
    });
  });

  it("explains unknown catalog specialists", () => {
    expect(() =>
      generate(config({ specialists: [{ id: "nope", enabled: true }] }), catalog),
    ).toThrow(/isn't in the catalog.*custom:nope/);
  });

  it("rejects agents or MCP servers whose names would clash", () => {
    const withStub = {
      ...catalog,
      specialists: new Map([
        [
          "twilio",
          {
            id: "twilio",
            title: "Twilio",
            description: "Catalog Twilio specialist for messaging work.",
            defaultModel: "haiku" as const,
            tools: ["Read" as const],
            docs: [],
            mcp: {
              name: "twilio",
              server: { type: "stdio" as const, command: "npx", args: [], env: {} },
              requires: [],
            },
            prompt: "Knows Twilio messaging, numbers, compliance and delivery receipts in depth.",
          },
        ],
      ]),
    };
    const custom = { id: "custom:twilio", enabled: true, title: "T", description: "T" };
    expect(() =>
      generate(config({ specialists: [{ id: "twilio", enabled: true }, custom] }), withStub),
    ).toThrow('Two agents would both be called "twilio-specialist"');
    expect(() =>
      generate(
        config({
          specialists: [
            { id: "twilio", enabled: true, mcp: true },
            { ...custom, id: "custom:sms", mcp: { command: "x" } },
          ],
        }),
        withStub,
      ),
    ).not.toThrow();
    expect(() =>
      generate(
        config({
          specialists: [
            { id: "twilio", enabled: true, mcp: true },
            { ...custom, mcp: { command: "x" } },
          ],
        }),
        withStub,
      ),
    ).toThrow('Two specialists use the MCP server name "twilio" with different settings');
  });

  it("warns when mcp is on but the catalog entry has no server", () => {
    const withStub = {
      ...catalog,
      specialists: new Map([
        [
          "docs",
          {
            id: "docs",
            title: "Docs",
            description: "A specialist with no MCP server at all.",
            defaultModel: "haiku" as const,
            tools: ["Read" as const],
            docs: [],
            prompt: "Knows documentation tooling, static site generators and style guides.",
          },
        ],
      ]),
    };
    const out = generate(
      config({ specialists: [{ id: "docs", enabled: true, mcp: true }] }),
      withStub,
    );
    expect(out.warnings).toEqual([
      'Specialist "docs" has "mcp": true but the catalog has no MCP server for it.',
    ]);
    expect(out.agents[0]!.model).toBe("haiku");
  });
});

describe("catalog specialists", () => {
  it("builds every catalog specialist with its MCP server", () => {
    const out = generate(
      config({
        specialists: [...catalog.specialists.keys()].map((id) => ({
          id,
          enabled: true,
          mcp: true,
        })),
      }),
      catalog,
    );
    expect(out.warnings).toEqual([]);
    expect(out.agents.map((a) => a.name).sort()).toEqual(
      [...catalog.specialists.keys()].map((id) => `${id}-specialist`).sort(),
    );
    // Power Platform and Microsoft 365 share one Microsoft Learn server.
    expect(Object.keys(out.mcpServers).sort()).toEqual([
      "aws-knowledge",
      "azure",
      "dataverse",
      "github",
      "google-developer-knowledge",
      "microsoft-learn",
      "salesforce",
      "stripe",
    ]);
    for (const id of ["power-platform", "microsoft-365"]) {
      expect(out.agents.find((a) => a.name === `${id}-specialist`)!.tools).toContain(
        "mcp__microsoft-learn",
      );
    }
    expect(out.mcpServers.dataverse).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "@microsoft/dataverse", "mcp", "${DATAVERSE_URL}"],
    });
    expect(out.mcpServers.github).toEqual({
      type: "http",
      url: "https://api.githubcopilot.com/mcp/",
      headers: { Authorization: "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}" },
    });
    expect(out.mcp.find((m) => m.name === "github")!.requires).toEqual([
      "GITHUB_PERSONAL_ACCESS_TOKEN",
    ]);
  });

  it("leaves MCP off unless asked, and still gives docs links", () => {
    const out = generate(config({ specialists: [{ id: "azure", enabled: true }] }), catalog);
    expect(out.mcpServers).toEqual({});
    const file = out.files.find((f) => f.path === ".claude/agents/azure-specialist.md")!.content;
    expect(file).not.toContain("mcp__azure");
    expect(file).toContain("https://learn.microsoft.com/azure/");
    expect(file).toContain("### What to bring");
  });
});

describe("envVarsIn", () => {
  it("finds every variable a server refers to", () => {
    expect(
      envVarsIn({
        type: "stdio",
        command: "npx",
        args: ["x", "${ORG_URL}"],
        env: { KEY: "env:MY_KEY" },
      }).sort(),
    ).toEqual(["MY_KEY", "ORG_URL"]);
    expect(
      envVarsIn({
        type: "http",
        url: "https://x.example",
        headers: { A: "Bearer {env:TOKEN}", B: "{env:OTHER}" },
      }).sort(),
    ).toEqual(["OTHER", "TOKEN"]);
  });
});

describe("toMcpJson", () => {
  it("turns env references into ${VAR}", () => {
    expect(
      toMcpJson({
        type: "http",
        url: "https://x.example/mcp",
        headers: { Authorization: "Bearer {env:TOKEN}" },
      }),
    ).toEqual({
      type: "http",
      url: "https://x.example/mcp",
      headers: { Authorization: "Bearer ${TOKEN}" },
    });
    expect(toMcpJson({ type: "stdio", command: "uvx", args: ["srv"], env: {} })).toEqual({
      type: "stdio",
      command: "uvx",
      args: ["srv"],
    });
  });
});

describe("render", () => {
  it("fills placeholders and refuses unknown ones", () => {
    expect(render("Hi {{name}}, $ARGUMENTS", { name: "Joe" })).toBe("Hi Joe, $ARGUMENTS");
    expect(() => render("{{missing}}", {})).toThrow(GenerateError);
  });
});
