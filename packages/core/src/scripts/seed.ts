/*
 * Development data: the dev sign-in users, one project with targets on the kind cluster's mock ticketing
 * service, a test-data pool and the Checkout scenario. Idempotent; never touches existing rows.
 *   pnpm db:seed            (after db:migrate and the runner image build: it syncs journeys/dist/catalog.json first)
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ParamValue, RunnerCatalog } from "@btb/contracts";
import { and, eq } from "drizzle-orm";

import { syncCatalog } from "../catalog";
import { createDb, projects, scenarios, scenarioVersions, targets, testDataPools, users } from "../db";
import { DEV_ACCOUNTS } from "../dev-accounts";
import { databaseUrl } from "../env";

const PROJECT = { id: "arbiter-ticketing", name: "Ticketing", description: "Ticketing platform: events, orders, tickets." };

// infra/kind/manifests/20-targets.yaml. Peaks are small on purpose: the kind namespaces have a 2-CPU quota.
const MOCK_HOST = "mock-target.targets.svc.cluster.local:3000";
const TARGETS = [
  { name: "mock-target", environment: "staging" },
  { name: "mock-target-prod", environment: "prod-like" },
].map((t) => ({
  ...t,
  peakVus: 20,
  peakRps: 40,
  hosts: [MOCK_HOST],
  paths: ["/events", "/orders", "/scan", "/carts", "/checkouts", "/payments"],
  methods: ["GET", "POST"],
  healthPath: "/healthz",
  // ponytail: both targets share one mock, so overlapping runs on the two would mix their integrity counts.
  integrityPath: "/__admin/integrity",
}));

const SCENARIOS: { name: string; journey: string; version: { model: "vus" | "rps"; p95Ms: number; errorRatePct: number; params: Record<string, ParamValue> } }[] = [
  {
    name: "Browse event",
    journey: "browse-event",
    version: { model: "vus", p95Ms: 500, errorRatePct: 1, params: { eventId: "any", thinkTimeSec: 2 } },
  },
  {
    name: "Receive ticket",
    journey: "receive-poll",
    version: { model: "vus", p95Ms: 500, errorRatePct: 1, params: { eventId: "evt-2", pollIntervalSec: 2, deadlineSec: 60, thinkTimeSec: 1 } },
  },
  {
    name: "Scan ticket",
    journey: "scan-ticket",
    version: { model: "rps", p95Ms: 300, errorRatePct: 1, params: { gate: "gate-a", ticketPool: 100000, thinkTimeSec: 0 } },
  },
];

const catalogFile = resolve("../../journeys/dist/catalog.json");
if (!existsSync(catalogFile)) {
  console.error("journeys/dist/catalog.json is missing: run `pnpm --filter @btb/journeys image` first.");
  process.exit(1);
}

const { db, pool } = createDb({ connectionString: databaseUrl() });
try {
  const { tag } = await syncCatalog(db, JSON.parse(readFileSync(catalogFile, "utf8")) as RunnerCatalog);

  await db.transaction(async (tx) => {
    const people = DEV_ACCOUNTS.filter((a) => !a.failsSso).map(({ name, email, role }) => ({ name, email, role }));
    await tx.insert(users).values(people).onConflictDoNothing();
    const [admin] = await tx.select({ id: users.id }).from(users).where(eq(users.email, DEV_ACCOUNTS[0].email));

    await tx.insert(projects).values(PROJECT).onConflictDoNothing();
    await tx
      .insert(targets)
      .values(TARGETS.map((t) => ({ ...t, projectId: PROJECT.id })))
      .onConflictDoNothing();

    const [staging] = await tx
      .select({ id: targets.id })
      .from(targets)
      .where(and(eq(targets.projectId, PROJECT.id), eq(targets.name, "mock-target")));
    const reset = { kind: "http" as const, name: "POST /__admin/reset", method: "POST", url: "http://mock-target.targets.svc.cluster.local:3000/__admin/reset" };
    await tx
      .insert(testDataPools)
      .values({ targetId: staging.id, total: 50, secretPath: "local/mock-target/identities", seedHook: reset })
      .onConflictDoNothing();

    await tx.insert(scenarios).values({ projectId: PROJECT.id, name: "Checkout", journeyId: "checkout" }).onConflictDoNothing();
    const [checkout] = await tx
      .select({ id: scenarios.id })
      .from(scenarios)
      .where(and(eq(scenarios.projectId, PROJECT.id), eq(scenarios.name, "Checkout")));
    await tx
      .insert(scenarioVersions)
      .values({
        scenarioId: checkout.id,
        version: 1,
        model: "vus",
        browser: false,
        p95Ms: 500,
        errorRatePct: 1,
        imageTag: tag,
        params: { eventId: "evt-1", ticketsPerOrder: 1, thinkTimeSec: 1 },
        note: "Seeded",
        createdBy: admin.id,
      })
      .onConflictDoNothing();

    for (const s of SCENARIOS) {
      await tx.insert(scenarios).values({ projectId: PROJECT.id, name: s.name, journeyId: s.journey }).onConflictDoNothing();
      const [row] = await tx
        .select({ id: scenarios.id })
        .from(scenarios)
        .where(and(eq(scenarios.projectId, PROJECT.id), eq(scenarios.name, s.name)));
      await tx
        .insert(scenarioVersions)
        .values({ scenarioId: row.id, version: 1, browser: false, imageTag: tag, note: "Seeded", createdBy: admin.id, ...s.version })
        .onConflictDoNothing();
    }
  });
  console.log(`seeded project ${PROJECT.id} (runner image ${tag})`);
} finally {
  await pool.end();
}
