import "server-only";

import { DEV_ACCOUNTS } from "@btb/core/dev-accounts";
import type { Hook } from "@btb/core/db";
import { asc, count, desc, eq, isNull } from "drizzle-orm";

import { db, schema } from "@/db";
import { getCatalog, getCeilings } from "@/lib/server/catalog";
import { listProjects } from "@/lib/server/projects";
import { listPeople } from "@/lib/server/users";
import { ENVIRONMENTS } from "@/lib/runs/environments";

/*
 * What the Admin page shows (UI-07): projects with their counts, the active project's targets and
 * test-data pools, ceilings, people, and recent admin activity from audit_logs.
 */

const { auditLogs, runs, scenarios, targets, testDataPools } = schema;

export interface AuditEntry {
  at: string;
  by: string;
  action: string;
  detail: string;
}

/** Test-data pools (PRD E2.6, story 28): identities per target, split per runner pod, credentials from External Secrets. */
export interface TestDataPool {
  targetId: string;
  /** False for a target with no pool row yet: runs on it skip the test-data check. */
  configured: boolean;
  total: number;
  inUse: number;
  secretPath: string;
  seedHook: string | null;
  cleanupHook: string | null;
  /** The editable parts of HTTP hooks; null for none (or an SQL hook, which the form can't edit). */
  seed: HookParts | null;
  cleanup: HookParts | null;
}
export type HookParts = { method: string; path: string };

function hookParts(h: Hook | null): HookParts | null {
  if (h?.kind !== "http") return null;
  const u = new URL(h.url);
  return { method: (h.method ?? "POST").toUpperCase(), path: u.pathname + u.search };
}

const countBy = <K extends string>(rows: { key: K; n: number }[]) => new Map(rows.map((r) => [r.key, r.n]));

export async function loadAdmin(projectId: string) {
  const [projects, catalog, ceilings, people, targetRuns, projectRuns, projectTargets, projectScenarios, pools, audit] = await Promise.all([
    listProjects(),
    getCatalog(projectId),
    getCeilings(),
    listPeople(),
    db.select({ key: targets.name, n: count() }).from(runs).innerJoin(targets, eq(targets.id, runs.targetId)).where(eq(runs.projectId, projectId)).groupBy(targets.name),
    db.select({ key: runs.projectId, n: count() }).from(runs).groupBy(runs.projectId),
    db.select({ key: targets.projectId, n: count() }).from(targets).groupBy(targets.projectId),
    db.select({ key: scenarios.projectId, n: count() }).from(scenarios).groupBy(scenarios.projectId),
    db
      .select({ name: targets.name, pool: testDataPools })
      .from(testDataPools)
      .innerJoin(targets, eq(targets.id, testDataPools.targetId))
      .where(eq(targets.projectId, projectId))
      .orderBy(asc(targets.name)),
    // Admin changes only; run events are on each run's timeline.
    db.select().from(auditLogs).where(isNull(auditLogs.runId)).orderBy(desc(auditLogs.at)).limit(20),
  ]);

  const runsPer = countBy(targetRuns);
  const [r, t, s] = [countBy(projectRuns), countBy(projectTargets), countBy(projectScenarios)];
  const seeded = new Set(DEV_ACCOUNTS.map((a) => a.email.toLowerCase()));
  const hook = (h: { name: string; kind: string } | null) => (h ? `${h.name} (${h.kind.toUpperCase()})` : null);

  return {
    projects: projects.map((p) => ({ ...p, targets: t.get(p.id) ?? 0, scenarios: s.get(p.id) ?? 0, runs: r.get(p.id) ?? 0 })),
    targets: catalog.targets.map((x) => ({ ...x, runs: runsPer.get(x.id) ?? 0 })),
    environments: ENVIRONMENTS.map((e) => ({ ...e, ceiling: ceilings[e.id] })),
    people: people.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, added: !seeded.has(u.email.toLowerCase()) })),
    // In use needs the worker's per-run split; nothing reports it yet.
    pools: catalog.targets.map(({ id }): TestDataPool => {
      const pool = pools.find((p) => p.name === id)?.pool;
      if (!pool) return { targetId: id, configured: false, total: 0, inUse: 0, secretPath: "", seedHook: null, cleanupHook: null, seed: null, cleanup: null };
      return {
        targetId: id,
        configured: true,
        total: pool.total,
        inUse: 0,
        secretPath: pool.secretPath,
        seedHook: hook(pool.seedHook),
        cleanupHook: hook(pool.cleanupHook),
        seed: hookParts(pool.seedHook),
        cleanup: hookParts(pool.cleanupHook),
      };
    }),
    audit: audit.map((a): AuditEntry => ({ at: a.at.toISOString(), by: a.actorName, action: a.action, detail: a.detail ?? "" })),
  };
}
