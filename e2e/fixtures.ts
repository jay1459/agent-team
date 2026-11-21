import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base } from "@playwright/test";

const CLI = join(import.meta.dirname, "../packages/cli/dist/cli.js");

type Ui = { url: string; projectDir: string; home: string; stop: () => void };

/** Start `agent-team ui` on a free port for a fresh project folder. */
async function startUi(opts: { config?: unknown } = {}): Promise<Ui> {
  const projectDir = mkdtempSync(join(tmpdir(), "agent-team-e2e-"));
  const home = mkdtempSync(join(tmpdir(), "agent-team-e2e-home-"));
  if (opts.config) writeFileSync(join(projectDir, "team.json"), JSON.stringify(opts.config));
  const child: ChildProcess = spawn(
    process.execPath,
    [CLI, "ui", "-C", projectDir, "--port", "0"],
    {
      env: { ...process.env, AGENT_TEAM_HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const url = await new Promise<string>((resolve, reject) => {
    let out = "";
    const timer = setTimeout(
      () => reject(new Error(`agent-team ui didn't start:\n${out}`)),
      10_000,
    );
    child.stdout!.on("data", (d: Buffer) => {
      out += d.toString();
      const m = /Open: (\S+)/.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]!);
      }
    });
    child.stderr!.on("data", (d: Buffer) => (out += d.toString()));
    child.on("exit", (code) => reject(new Error(`agent-team ui exited (${code}):\n${out}`)));
  });
  return { url, projectDir, home, stop: () => child.kill("SIGTERM") };
}

export const test = base.extend<{ startUi: typeof startUi }>({
  startUi: async ({ page }, use) => {
    const started: Ui[] = [];
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await use(async (opts) => {
      const ui = await startUi(opts);
      started.push(ui);
      return ui;
    });
    for (const ui of started) ui.stop();
    if (errors.length) throw new Error(`Browser errors:\n${errors.join("\n")}`);
  },
});

export { expect } from "@playwright/test";
