import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main, runDeps } from "../src/cli.js";
import { fakeSdk, msg } from "./fake-sdk.js";
import { catalog, fakeIo, tempDir } from "./helpers.js";

const original = { ...runDeps };
afterEach(() => Object.assign(runDeps, original));

function project() {
  const dir = tempDir();
  writeFileSync(
    join(dir, "team.json"),
    JSON.stringify({
      version: 1,
      project: { name: "X" },
      roles: { pm: { enabled: true }, "lead-dev": { enabled: true }, developer: { enabled: true } },
    }),
  );
  return dir;
}

describe("agent-team run / runs", () => {
  it("runs, prints progress and cost, then continues the latest session", async () => {
    const dir = project();
    const { sdk, calls } = fakeSdk(() => [
      msg.init("sess-7"),
      msg.text("Which database?"),
      msg.result({ session_id: "sess-7" }),
    ]);
    runDeps.sdk = async () => sdk;
    runDeps.env = () => ({});

    const first = fakeIo(dir);
    expect(await main(["run", "Build", "a", "blog", "--budget", "2"], first.io, catalog)).toBe(0);
    expect(calls[0]).toMatchObject({ prompt: "Build a blog", options: { maxBudgetUsd: 2 } });
    expect(first.text()).toContain("[pm] Which database?");
    expect(first.text()).toContain("Finished: $0.25, 4 turns.");
    expect(first.text()).toMatch(/Log: team\/runs\/.+\.jsonl/);

    const next = fakeIo(dir);
    expect(await main(["run", "--continue", "Use Postgres"], next.io, catalog)).toBe(0);
    expect(calls[1]).toMatchObject({ prompt: "Use Postgres", options: { resume: "sess-7" } });

    const list = fakeIo(dir);
    await main(["runs"], list.io, catalog);
    expect(list.out).toHaveLength(2);
    expect(list.out[1]).toMatch(/done\s+\$0\.25\s+Build a blog/);
  });

  it("passes --layered, --flat and --yes through", async () => {
    const dir = project();
    const { sdk, calls } = fakeSdk(() => [msg.result()]);
    runDeps.sdk = async () => sdk;
    await main(["run", "Go", "--layered", "--yes"], fakeIo(dir).io, catalog);
    expect(Object.keys(calls[0]!.options.mcpServers!)).toEqual(["agent_team"]);
    expect(
      await calls[0]!.options.canUseTool!("Bash", { command: "ls" }, {} as never),
    ).toMatchObject({ behavior: "allow" });

    await main(["run", "Go", "--flat"], fakeIo(dir).io, catalog);
    expect(calls[1]!.options.mcpServers).toEqual({});
  });

  it("explains usage mistakes", async () => {
    const dir = project();
    runDeps.sdk = async () => fakeSdk(() => [msg.result()]).sdk;
    expect(await main(["run"], fakeIo(dir).io, catalog)).toBe(2);
    expect(await main(["run", "x", "--budget", "-1"], fakeIo(dir).io, catalog)).toBe(2);
    expect(await main(["run", "x", "--layered", "--flat"], fakeIo(dir).io, catalog)).toBe(2);
    const cont = fakeIo(dir);
    expect(await main(["run", "--continue", "yes"], cont.io, catalog)).toBe(1);
    expect(cont.errors()).toContain("no earlier run");
    const none = fakeIo(dir);
    await main(["runs"], none.io, catalog);
    expect(none.text()).toContain("No runs yet");
  });

  it("exits 1 when the run stops early", async () => {
    const dir = project();
    runDeps.sdk = async () =>
      fakeSdk(() => [msg.result({ subtype: "error_max_turns", is_error: true })]).sdk;
    const io = fakeIo(dir);
    expect(await main(["run", "Go"], io.io, catalog)).toBe(1);
    expect(io.text()).toContain("Stopped (error_max_turns)");
  });
});
