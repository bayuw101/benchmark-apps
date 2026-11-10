import { writeAudit } from "@btb/core/audit";
import { targets, testDataPools, type Hook } from "@btb/core/db";
import { eq } from "drizzle-orm";

import type { Ctx } from "./context";
import { kubeErrorMessage, withTimeout } from "./kube";
import { errorMessage, log } from "./log";
import { clusterService } from "./plan";

/*
 * Test-data hooks (E2.6): the pool's seed hook runs before load starts, its cleanup hook after every run,
 * whatever the outcome. PROPOSAL (TBD-6): only HTTP hooks, and only to one of the target's own hosts; SQL hooks
 * are refused until their security model is decided.
 */

const HOOK_TIMEOUT_MS = 15_000;
const METHODS = ["POST", "PUT", "DELETE"] as const;
type Method = (typeof METHODS)[number];

export async function runHook(ctx: Ctx, hook: Hook, hosts: string[]) {
  if (hook.kind !== "http") throw new Error("SQL hooks aren't supported yet (TBD-6)");
  const url = new URL(hook.url);
  if (!hosts.includes(url.host)) throw new Error(`${url.host} isn't one of the target's hosts`);
  const method = (hook.method ?? "POST").toUpperCase() as Method;
  if (!METHODS.includes(method)) throw new Error(`method ${method} isn't allowed for hooks`);
  const svc = clusterService(url.host);
  if (svc) {
    await withTimeout(ctx.kube.serviceCall(method, svc.namespace, svc.name, svc.port, url.pathname + url.search), HOOK_TIMEOUT_MS, "Hook");
    return;
  }
  const res = await fetch(url, { method, redirect: "manual", signal: AbortSignal.timeout(HOOK_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function poolOf(ctx: Ctx, targetId: string) {
  const [row] = await ctx.db
    .select({ seed: testDataPools.seedHook, cleanup: testDataPools.cleanupHook, hosts: targets.hosts })
    .from(testDataPools)
    .innerJoin(targets, eq(targets.id, testDataPools.targetId))
    .where(eq(testDataPools.targetId, targetId));
  return row ?? null;
}

/** Preflight "test data": null when the target has no seed hook (the web app's pool check stands). */
export async function seedTestData(ctx: Ctx, targetId: string): Promise<{ state: "pass" | "fail"; reason: string } | null> {
  const pool = await poolOf(ctx, targetId);
  if (!pool?.seed) return null;
  try {
    await runHook(ctx, pool.seed, pool.hosts);
    return { state: "pass", reason: `Seed hook ${pool.seed.name} ran.` };
  } catch (e) {
    return { state: "fail", reason: `Seed hook ${pool.seed.name} failed: ${kubeErrorMessage(e)}` };
  }
}

/** After every run. A failure goes on the timeline; it doesn't change the run's outcome. */
export async function cleanupTestData(ctx: Ctx, run: { id: string; projectId: string; targetId: string }) {
  try {
    const pool = await poolOf(ctx, run.targetId);
    if (!pool?.cleanup) return;
    const audit = { actor: null, projectId: run.projectId, runId: run.id };
    try {
      await runHook(ctx, pool.cleanup, pool.hosts);
      await writeAudit(ctx.db, { ...audit, action: "Test data cleaned up", detail: `Cleanup hook ${pool.cleanup.name} ran.`, tone: "success" });
    } catch (e) {
      await writeAudit(ctx.db, { ...audit, action: "Cleanup hook failed", detail: `${pool.cleanup.name}: ${kubeErrorMessage(e)}`, tone: "warning" });
    }
  } catch (e) {
    log.warn("test-data cleanup failed", { runId: run.id, reason: errorMessage(e) });
  }
}
