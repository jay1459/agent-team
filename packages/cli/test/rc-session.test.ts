import { describe, expect, it } from "vitest";
import {
  sessionStatus,
  startSession,
  stopSession,
  tmuxSessionName,
  trustFolder,
} from "../src/rc-session.js";
import { fakeTmux } from "./helpers.js";

const dir = "/home/me/projects/My Project!";

describe("Remote Control sessions", () => {
  it("names tmux sessions safely and stably per project", () => {
    expect(tmuxSessionName(dir)).toMatch(/^agent-team-my-project-[0-9a-f]{6}$/);
    expect(tmuxSessionName(dir)).toBe(tmuxSessionName(`${dir}/`));
    expect(tmuxSessionName(dir)).not.toBe(tmuxSessionName("/elsewhere/My Project!"));
  });

  it("says what's missing", () => {
    const { deps } = fakeTmux(["claude"]);
    expect(sessionStatus(dir, deps)).toMatchObject({
      available: false,
      missing: ["tmux"],
      running: false,
    });
    expect(() => startSession({ projectDir: dir, goal: "x", name: "n" }, deps)).toThrow(
      "needs tmux",
    );
  });

  it("starts claude with Remote Control and the /team goal, as separate arguments", () => {
    const { deps, calls } = fakeTmux();
    const status = startSession(
      {
        projectDir: dir,
        goal: "  Build it;\n rm -rf / `x`  ",
        name: "My team <script>",
        permissionMode: "auto",
      },
      deps,
    );
    const start = calls.find((c) => c[1] === "new-session")!;
    expect(start.slice(0, 11)).toEqual([
      "tmux",
      "new-session",
      "-d",
      "-s",
      tmuxSessionName(dir),
      "-x",
      "200",
      "-y",
      "50",
      "-c",
      dir,
    ]);
    expect(start.slice(11)).toEqual([
      "claude",
      "--remote-control=My team script",
      "--permission-mode",
      "auto",
      "/team Build it; rm -rf / `x`",
    ]);
    expect(status).toMatchObject({ running: true, waitingFor: "trust" });
    expect(status.url).toBeUndefined();
  });

  it("validates before starting", () => {
    const { deps } = fakeTmux();
    expect(() => startSession({ projectDir: dir, goal: "   ", name: "n" }, deps)).toThrow(
      "Say what the team should do",
    );
    expect(() =>
      startSession({ projectDir: dir, goal: "x".repeat(4001), name: "n" }, deps),
    ).toThrow("under 4000");
    expect(() =>
      startSession(
        { projectDir: dir, goal: "x", name: "n", permissionMode: "bypassPermissions" as never },
        deps,
      ),
    ).toThrow("Unknown permission mode");
    startSession({ projectDir: dir, goal: "x", name: "n" }, deps);
    expect(() => startSession({ projectDir: dir, goal: "x", name: "n" }, deps)).toThrow(
      "already running",
    );
  });

  it("answers the trust question only when it's asked, then shows the link", () => {
    const { deps } = fakeTmux();
    startSession({ projectDir: dir, goal: "Go", name: "n" }, deps);
    const after = trustFolder(dir, deps);
    expect(after).toMatchObject({ running: true, url: "https://claude.ai/code/session_ABC123" });
    expect(after.waitingFor).toBeUndefined();
    expect(() => trustFolder(dir, deps)).toThrow("isn't asking");
  });

  it("stops the session", () => {
    const { deps } = fakeTmux();
    startSession({ projectDir: dir, goal: "Go", name: "n" }, deps);
    expect(stopSession(dir, deps).running).toBe(false);
    expect(stopSession(dir, deps).running).toBe(false);
  });
});
