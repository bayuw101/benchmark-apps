import "server-only";

import { writeAudit } from "@btb/core/audit";
import { and, eq, max } from "drizzle-orm";

import { isUniqueViolation } from "@btb/core/db";
import { db, schema } from "@/db";
import { journeyOf, type ProjectCatalog, type ScenarioVersion } from "@/lib/runs/catalog";
import type { ResolvedScenario } from "@/lib/runs/scenarios";
import type { SessionUser } from "@/lib/session";

const { scenarioVersions, scenarios } = schema;

/**
 * Saves a validated scenario as v1, or a new version of an existing one (versions are immutable, E2.3).
 * Null when someone else saved the same name or version first (the caller answers 409).
 */
export async function saveScenario(
  projectId: string,
  catalog: ProjectCatalog,
  r: ResolvedScenario,
  user: SessionUser,
  now: Date,
): Promise<{ scenario: string; version: ScenarioVersion } | null> {
  const journey = journeyOf(catalog, r.journey);
  if (!journey || !catalog.image) throw new Error("saveScenario needs a validated scenario");
  const { tag: imageTag, protocol: runnerProtocol } = catalog.image;
  const note = r.note ?? (r.isNew ? "First version" : null);

  try {
    return await db.transaction(async (tx) => {
      const [scenario] = r.isNew
        ? await tx.insert(scenarios).values({ projectId, name: r.name, journeyId: journey.id, createdAt: now }).returning({ id: scenarios.id })
        : await tx.select({ id: scenarios.id }).from(scenarios).where(and(eq(scenarios.projectId, projectId), eq(scenarios.name, r.name)));
      if (!scenario) return null;
      const [{ latest }] = await tx.select({ latest: max(scenarioVersions.version) }).from(scenarioVersions).where(eq(scenarioVersions.scenarioId, scenario.id));
      const version = (latest ?? 0) + 1;
      await tx.insert(scenarioVersions).values({
        scenarioId: scenario.id,
        version,
        model: r.model,
        browser: journey.browser,
        p95Ms: r.thresholds.p95Ms,
        errorRatePct: r.thresholds.errorRatePct,
        imageTag,
        params: r.params,
        note,
        createdBy: user.id,
        createdAt: now,
      });
      await writeAudit(tx, {
        actor: { id: user.id, name: user.name },
        action: "Saved scenario",
        detail: `${r.name} v${version} (${journey.id}, ${imageTag})`,
        projectId,
      });
      return {
        scenario: r.name,
        version: {
          version,
          model: r.model,
          browser: journey.browser,
          thresholds: r.thresholds,
          imageVersion: imageTag,
          runnerProtocol,
          params: r.params,
          createdBy: user.name,
          createdAt: now.toISOString(),
          note: note ?? undefined,
        },
      };
    });
  } catch (e) {
    if (isUniqueViolation(e)) return null;
    throw e;
  }
}
