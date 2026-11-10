import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

import { DEV_DATABASE_URL } from "./src/env";

// The database tests run against DATABASE_URL: the environment, else .env.local, else the local Compose stack.
// In CI (CI set) there is no fallback: the pipeline provides a Postgres service and DATABASE_URL, or they skip.
if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
if (!process.env.DATABASE_URL && !process.env.CI) process.env.DATABASE_URL = DEV_DATABASE_URL;

export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
