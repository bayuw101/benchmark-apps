/*
 * Load journeys/dist/catalog.json (written by the runner image build) into the database.
 *   pnpm catalog:sync [path/to/catalog.json]
 * Proposal, not in the PRD: the PRD says the catalog is synced from the runner image but not how; in CI the
 * same command would run after the image is pushed, with the pushed digest.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { RunnerCatalog } from "@btb/contracts";

import { syncCatalog } from "../catalog";
import { createDb } from "../db";
import { databaseUrl } from "../env";

const file = resolve(process.argv[2] ?? "../../journeys/dist/catalog.json");
const catalog = JSON.parse(readFileSync(file, "utf8")) as RunnerCatalog;
const { db, pool } = createDb({ connectionString: databaseUrl() });
try {
  const res = await syncCatalog(db, catalog, process.env.RUNNER_DIGEST ?? null);
  console.log(`synced runner image ${res.tag}: ${res.journeys.join(", ")}`);
} finally {
  await pool.end();
}
