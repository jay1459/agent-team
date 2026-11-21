import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Test against the schema's source, so tests don't need a build first.
    alias: {
      "@agent-team/schema": fileURLToPath(new URL("packages/schema/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
  },
});
