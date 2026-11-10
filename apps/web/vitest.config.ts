import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// DATABASE_URL from .env.local, for the database tests (skipped when unset). Node's own loader: `vite` isn't a
// direct dependency, so importing it breaks the image build (pnpm doesn't hoist it there).
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws outside a React Server build; tests run server modules directly.
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: { include: ["src/**/*.test.ts"] },
});
