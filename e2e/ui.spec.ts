import { existsSync, readFileSync } from "node:fs";
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

  await page.locator('[data-role="developer"]').getByLabel("How many").fill("2");
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
  await expect(page.getByText("plus 5 agents")).toBeVisible();
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
