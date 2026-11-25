import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./fixtures.ts";

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));

test("asks for the token link when opened without one", async ({ page, startUi }) => {
  const ui = await startUi();
  await page.goto(ui.url.split("#")[0]!);
  await expect(page.getByText("needs the link printed by")).toBeVisible();
});

test("creates a team from a profile, edits it and applies", async ({ page, startUi }) => {
  const ui = await startUi();
  await page.goto(ui.url);
  await expect(page).toHaveURL(/\/$/); // token moved out of the address bar

  await page.getByLabel("Project name").fill("Contoso");
  await page.getByLabel(/dev-team/).check();
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("status")).toHaveText("Not saved yet");

  await page.locator('[data-role="developer"]').getByLabel("How many").selectOption("2");
  await page.locator('[data-role="sales"]').getByRole("checkbox").first().check();
  await page.locator('[data-role="sales"]').getByLabel("Model").selectOption("sonnet");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");

  const saved = readJson(join(ui.projectDir, "team.json"));
  expect(saved.extends).toBe("dev-team");
  expect(saved.project.name).toBe("Contoso");
  expect(saved.roles.developer.count).toBe(2);
  expect(saved.roles.sales).toEqual({ enabled: true, model: "sonnet" });

  await page.getByRole("tab", { name: "Preview & apply" }).click();
  await expect(page.getByText("plus 6 agents")).toBeVisible();
  const salesFile = page
    .locator("details")
    .filter({ has: page.getByText(".claude/agents/sales.md", { exact: true }) });
  await salesFile.locator("summary").click();
  await expect(salesFile.locator("pre.diff")).toContainText("+model: sonnet");
  await page.getByRole("button", { name: /^Apply \d+ changes$/ }).click();
  await page.getByRole("button", { name: "Yes, write them" }).click();
  await expect(page.getByText(/Wrote \d+ file/)).toBeVisible();
  await expect(page.getByText("Everything is up to date")).toBeVisible();

  expect(existsSync(join(ui.projectDir, ".claude/agents/developer-2.md"))).toBe(true);
  expect(readFileSync(join(ui.projectDir, ".claude/commands/team.md"), "utf8")).toContain(
    "model: opus",
  );
});

test("shows problems on the right tab and blocks saving until they're fixed", async ({
  page,
  startUi,
}) => {
  const ui = await startUi({
    config: { version: 1, project: { name: "X" }, roles: { pm: { enabled: true } } },
  });
  await page.goto(ui.url);

  await page.getByRole("tab", { name: "Specialists" }).click();
  await page.getByLabel("New specialist name").fill("Twilio SMS");
  await page.getByRole("button", { name: "Add specialist" }).click();
  await expect(
    page.getByRole("tab", { name: /Specialists/ }).getByLabel("1 problems"),
  ).toBeVisible();
  await expect(page.getByText("Say what this specialist knows")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();

  await page.getByLabel("What it knows").fill("Sends SMS through Twilio.");
  await page.getByLabel("MCP server").selectOption("http");
  await page.getByRole("button", { name: "Add header" }).click();
  await page.getByLabel("Header name").fill("Authorization");
  await page.getByLabel("Header value").fill("Bearer sk-live-123");
  await expect(page.getByText("Header values must be environment references")).toBeVisible();
  await page.getByLabel("Header value").fill("Bearer {env:TWILIO_TOKEN}");
  await page.getByLabel("URL", { exact: true }).fill("https://mcp.example.com/twilio");
  await expect(page.getByRole("status")).toHaveText("Unsaved changes");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");

  const saved = readJson(join(ui.projectDir, "team.json"));
  expect(saved.specialists).toEqual([
    {
      id: "custom:twilio-sms",
      enabled: true,
      title: "Twilio SMS",
      description: "Sends SMS through Twilio.",
      mcp: {
        type: "http",
        url: "https://mcp.example.com/twilio",
        headers: { Authorization: "Bearer {env:TWILIO_TOKEN}" },
      },
    },
  ]);
});

test("saves a profile and starts another team from it", async ({ page, startUi }) => {
  const ui = await startUi({
    config: {
      version: 1,
      project: { name: "X" },
      roles: { pm: { enabled: true }, architect: { enabled: true } },
    },
  });
  await page.goto(ui.url);
  await page.getByRole("tab", { name: "Profiles" }).click();
  await page.getByLabel("Profile name").fill("Arch Team");
  await expect(page.getByLabel("Profile name")).toHaveValue("arch-team");
  await page.getByLabel("Description").fill("PM and architect");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText(/Saved profile "arch-team"/)).toBeVisible();
  await expect(page.getByRole("row", { name: /arch-team/ })).toContainText("Saved by you");
  expect(existsSync(join(ui.home, "profiles/arch-team.json"))).toBe(true);

  page.once("dialog", (d) => void d.accept());
  await page
    .getByRole("row", { name: /consultancy/ })
    .getByRole("button", { name: "Use" })
    .click();
  await expect(page.getByText(/Loaded the "consultancy" profile/)).toBeVisible();
  await page.getByRole("tab", { name: "Team" }).click();
  await expect(page.locator('[data-role="sales"]').getByRole("checkbox").first()).toBeChecked();
  await expect(page.getByLabel("Project name")).toHaveValue("X");
});

test("edits the JSON directly", async ({ page, startUi }) => {
  const ui = await startUi({
    config: { version: 1, project: { name: "X" }, roles: { pm: { enabled: true } } },
  });
  await page.goto(ui.url);
  await page.getByRole("tab", { name: "JSON" }).click();
  const editor = page.getByLabel("team.json");
  await editor.fill(
    '{ "version": 1, "project": { "name": "From JSON" }, "roles": { "pm": { "enabled": true }, "architect": { "enabled": true } } ',
  );
  await expect(page.getByText("Not valid JSON yet")).toBeVisible();
  await editor.press("End");
  await editor.pressSequentially("}");
  await expect(page.getByText("Not valid JSON yet")).toBeHidden();
  await page.getByRole("tab", { name: "Team" }).click();
  await expect(page.getByLabel("Project name")).toHaveValue("From JSON");
  await expect(page.locator('[data-role="architect"]').getByRole("checkbox").first()).toBeChecked();
});

test("turns on catalog specialists and their MCP servers", async ({ page, startUi }) => {
  const ui = await startUi({
    config: { version: 1, project: { name: "X" }, roles: { pm: { enabled: true } } },
  });
  await page.goto(ui.url);
  await page.getByRole("tab", { name: "Specialists" }).click();

  const azure = page.locator('[data-specialist="azure"]');
  await azure.getByRole("checkbox").first().check();
  await azure.getByLabel(/Connect its MCP server/).check();
  await expect(azure.getByText("az login", { exact: false })).toBeVisible();

  const github = page.locator('[data-specialist="github"]');
  await github.getByRole("checkbox").first().check();
  await github.getByLabel(/Connect its MCP server/).check();
  await expect(github).toContainText("needs GITHUB_PERSONAL_ACCESS_TOKEN");

  await page.getByRole("tab", { name: "Preview & apply" }).click();
  await expect(page.getByText("azure-specialist", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Apply \d+ changes$/ }).click();
  await page.getByRole("button", { name: "Yes, write them" }).click();
  await expect(page.getByText(/Wrote \d+ file/)).toBeVisible();

  const mcp = readJson(join(ui.projectDir, ".mcp.json"));
  expect(Object.keys(mcp.mcpServers)).toEqual(["azure", "github"]);
  expect(mcp.mcpServers.github.headers.Authorization).toBe(
    "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}",
  );
});

test("sets runner options and shows run logs", async ({ page, startUi }) => {
  const ui = await startUi({
    config: {
      version: 1,
      project: { name: "X" },
      roles: { pm: { enabled: true }, "lead-dev": { enabled: true }, developer: { enabled: true } },
    },
  });
  const runs = join(ui.projectDir, "team/runs");
  mkdirSync(runs, { recursive: true });
  writeFileSync(
    join(runs, "2026-11-21T10-00-00-000Z.jsonl"),
    [
      {
        kind: "start",
        at: "2026-11-21T10:00:00.000Z",
        goal: "Add a blog",
        layered: true,
        agents: ["architect"],
      },
      { kind: "text", at: "x", agent: "pm", text: "Planning the blog." },
      { kind: "delegate", at: "x", task: "Build the post list" },
      { kind: "tool", at: "x", agent: "developer-1", tool: "Bash", summary: "npm test" },
      { kind: "delegate-done", at: "x", ok: true, costUsd: 0.8, turns: 6 },
      {
        kind: "result",
        at: "x",
        ok: true,
        subtype: "success",
        text: "Blog added.",
        costUsd: 0.4,
        teamCostUsd: 0.8,
        turns: 9,
        sessionId: "s",
      },
    ]
      .map((e) => JSON.stringify(e))
      .join("\n"),
  );

  await page.goto(ui.url);
  await page.getByRole("tab", { name: "Workflow" }).click();
  await page.getByLabel(/Layered team/).check();
  await page.getByLabel("Budget per run (USD)").fill("5");
  await page.getByLabel("Permissions").selectOption("default");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  expect(readJson(join(ui.projectDir, "team.json")).runner).toEqual({
    layered: true,
    maxBudgetUsd: 5,
    permissionMode: "default",
  });

  await page.getByRole("tab", { name: "Runs" }).click();
  const row = page.getByRole("row", { name: /Add a blog/ });
  await expect(row).toContainText("done");
  await expect(row).toContainText("$1.20");
  await row.getByRole("button").click();
  await expect(page.getByText("pm ⇒ lead-dev team:")).toBeVisible();
  await expect(page.getByText("Blog added.")).toBeVisible();
  await expect(page.locator(".run-log")).toContainText("developer-1 → Bash npm test");
});

test("starts by choosing the team's repository, never agent-team's own folder", async ({
  page,
  startUi,
}) => {
  const ui = await startUi({ noProject: true });
  mkdirSync(join(ui.projectDir, "agent-team"));
  writeFileSync(
    join(ui.projectDir, "agent-team", "package.json"),
    JSON.stringify({ name: "agent-team-monorepo" }),
  );
  await page.goto(ui.url);

  await expect(page.getByText("Where should the team work?")).toBeVisible();
  await page.getByLabel("Repository name").fill("ccaas-pipeline");
  await page.getByLabel("Description").fill("D365 CI/CD");
  await page.getByRole("button", { name: "Create repository" }).click();

  await expect(page.getByText("There's no team.json in")).toBeVisible();
  await page.getByLabel(/consultancy/).check();
  await page.getByRole("button", { name: "Create team" }).click();
  const qa = page.locator('[data-role="qa"]');
  await expect(qa.getByLabel("How many")).toHaveValue("pm-decides");
  await expect(page.locator('[data-role="security"]').getByRole("checkbox").first()).toBeChecked();
  await expect(page.locator('[data-role="uat-tester"]')).toBeVisible();
  await page.locator('[data-role="developer"]').getByLabel("How many").selectOption("pm-decides");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");

  const repo = join(ui.projectDir, "ccaas-pipeline");
  expect(existsSync(join(repo, ".git"))).toBe(true);
  expect(readJson(join(repo, "team.json")).roles.developer.count).toBe("pm-decides");
  expect(existsSync(join(ui.projectDir, "team.json"))).toBe(false);

  await page.getByRole("button", { name: "Change project" }).click();
  await page.getByText("Use an existing repository").click();
  await expect(page.getByRole("radio", { name: /ccaas-pipeline/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /^agent-team/ })).toHaveCount(0);
  await page.getByLabel("Folder", { exact: true }).fill("agent-team");
  await page.getByLabel(/Make it a git repository/).check();
  await page.getByRole("button", { name: "Use this repository" }).click();
  await expect(page.getByText(/part of agent-team itself/)).toBeVisible();
  expect(existsSync(join(ui.projectDir, "agent-team", ".git"))).toBe(false);
});

test("starts the team in a Remote Control session", async ({ page, startUi }) => {
  // Fake tmux and claude: sessions are files; the screen shows the trust question until Enter.
  const bin = mkdtempSync(join(tmpdir(), "agent-team-e2e-bin-"));
  const state = mkdtempSync(join(tmpdir(), "agent-team-e2e-tmux-"));
  writeFileSync(join(bin, "claude"), "#!/bin/sh\nexit 0\n");
  writeFileSync(
    join(bin, "tmux"),
    `#!/bin/sh
S=${state}
cmd=$1; shift
t=""; s=""
while [ $# -gt 0 ]; do case $1 in -t) t=$(echo "$2" | sed 's/^=//; s/:$//'); shift;; -s) s=$2; shift;; esac; shift; done
case $cmd in
  has-session) [ -f "$S/$t" ];;
  new-session) printf '%s\\n' "Yes, I trust this folder" > "$S/$s"; echo "$s" > "$S/last-name";;
  capture-pane) cat "$S/$t" 2>/dev/null;;
  send-keys) printf '%s\\n' "/remote-control is active at https://claude.ai/code/session_E2E42" > "$S/$t";;
  kill-session) rm -f "$S/$t";;
esac
`,
  );
  chmodSync(join(bin, "claude"), 0o755);
  chmodSync(join(bin, "tmux"), 0o755);

  const ui = await startUi({
    path: bin,
    config: {
      version: 1,
      project: { name: "Shop" },
      roles: { pm: { enabled: true }, developer: { enabled: true } },
    },
  });
  await page.goto(ui.url);
  await page.getByRole("tab", { name: "Start" }).click();
  await page.getByLabel("Goal for the PM").fill("Build the checkout");
  await expect(page.getByLabel("Session name")).toHaveValue("Shop team");
  await page.getByLabel("Permissions").selectOption("acceptEdits");
  await page.getByRole("button", { name: "Apply and start Remote Control session" }).click();

  await expect(page.getByText("The team is running")).toBeVisible();
  await page.getByRole("button", { name: "Yes, trust this folder" }).click();
  await expect(
    page.getByRole("link", { name: "https://claude.ai/code/session_E2E42" }),
  ).toBeVisible();
  expect(existsSync(join(ui.projectDir, ".claude/commands/team.md"))).toBe(true);

  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Stop session" }).click();
  await expect(page.getByRole("button", { name: "Start Remote Control session" })).toBeVisible();
});
