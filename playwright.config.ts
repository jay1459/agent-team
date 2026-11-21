import { defineConfig, devices } from "@playwright/test";

// Run with `npm run e2e`, which builds first. Each test starts its own `agent-team ui`.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  workers: 2,
  reporter: process.env.CI ? "github" : "list",
  use: { ...devices["Desktop Chrome"], trace: "off" },
});
