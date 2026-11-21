import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development, run `agent-team ui --port 7420` and `npm run dev:ui`; API calls are proxied.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@agent-team/schema": fileURLToPath(new URL("../schema/src/index.ts", import.meta.url)),
    },
  },
  server: { proxy: { "/api": "http://127.0.0.1:7420" } },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
});
