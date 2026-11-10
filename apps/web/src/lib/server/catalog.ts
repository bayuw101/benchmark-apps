import "server-only";

import { RUNNER_IMAGE_NAME } from "@btb/contracts";
import { asc, desc, eq } from "drizzle-orm";

import { db, schema } from "@/db";
import type { HttpMethod, ProjectCatalog, Scenario, Target } from "@/lib/runs/catalog";
import type { Ceiling } from "@/lib/runs/environments";
import type { Environment } from "@/lib/runs/types";

const { environments, journeys, runnerImages, scenarioVersions, scenarios, targets, users } = schema;

export function toTarget(t: typeof targets.$inferSelect): Target {
  return {
    id: t.name,
    name: t.name,
    environment: t.environment as Environment,
    referencePeak: { vus: t.peakVus, rps: t.peakRps },
    hosts: t.hosts,
    paths: t.paths,
    methods: t.methods as HttpMethod[],
    redirects: t.redirects,
    healthPath: t.healthPath,
    integrityPath: t.integrityPath,
  };
}

export async function getCeilings(): Promise<Record<Environment, Ceiling>> {
  const rows = await db.select().from(environments);
  const out = {} as Record<Environment, Ceiling>;
  for (const e of rows) out[e.id as Environment] = { vus: e.maxVus, rps: e.maxRps, durationSec: e.maxDurationSec, rampPerMin: e.maxRampPerMin };
  return out;
}

/** The project's targets, scenarios (versions newest first), the journey catalog and the current ceilings. */
export async function getCatalog(projectId: string): Promise<ProjectCatalog> {
  const [targetRows, versionRows, journeyRows, [image], ceilings] = await Promise.all([
    db.select().from(targets).where(eq(targets.projectId, projectId)).orderBy(asc(targets.name)),
    db
      .select({ scenario: scenarios, version: scenarioVersions, createdBy: users.name, runnerProtocol: runnerImages.protocol })
      .from(scenarios)
      .innerJoin(scenarioVersions, eq(scenarioVersions.scenarioId, scenarios.id))
      .innerJoin(users, eq(users.id, scenarioVersions.createdBy))
      .innerJoin(runnerImages, eq(runnerImages.tag, scenarioVersions.imageTag))
      .where(eq(scenarios.projectId, projectId))
      .orderBy(asc(scenarios.name), desc(scenarioVersions.version)),
    db.select().from(journeys).orderBy(asc(journeys.id)),
    db.select().from(runnerImages).orderBy(desc(runnerImages.syncedAt)).limit(1),
    getCeilings(),
  ]);

  const byName = new Map<string, Scenario>();
  for (const { scenario, version: v, createdBy, runnerProtocol } of versionRows) {
    const s = byName.get(scenario.name) ?? { name: scenario.name, journey: scenario.journeyId, versions: [] };
    s.versions.push({
      version: v.version,
      model: v.model,
      browser: v.browser,
      thresholds: v.p95Ms !== null && v.errorRatePct !== null ? { p95Ms: v.p95Ms, errorRatePct: v.errorRatePct } : null,
      imageVersion: v.imageTag,
      runnerProtocol,
      params: v.params,
      createdBy,
      createdAt: v.createdAt.toISOString(),
      note: v.note ?? undefined,
    });
    byName.set(scenario.name, s);
  }

  return {
    targets: targetRows.map(toTarget),
    scenarios: [...byName.values()],
    ceilings,
    journeys: journeyRows.map(({ id, title, description, version, browser, steps, params, budgets }) => ({ id, title, description, version, browser, steps, params, budgets })),
    image: image ? { name: RUNNER_IMAGE_NAME, tag: image.tag, protocol: image.protocol, syncedAt: image.syncedAt.toISOString() } : null,
  };
}
