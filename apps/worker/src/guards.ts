import { runs, targets } from "@btb/core/db";
import { eq } from "drizzle-orm";

import type { Ctx } from "./context";
import { probeTarget } from "./dispatch";
import { finishRun } from "./finish";
import { errorMessage, log } from "./log";
import { HEALTH_FAILS_TO_ABORT, lastPushQuery, TELEMETRY_LOSS_SEC, telemetrySilenceSec, type Outcome } from "./plan";

/*
 * Safety checks on running runs (E6.4, E6.5): abort when the target stops answering its health endpoint or
 * when runner telemetry stops arriving. Call under the worker lock, after reconcile.
 */

const BOOT_MS = Date.now();
const healthFails = new Map<string, number>();
const lastSeenMs = new Map<string, number>();

/** True when a run was aborted (capacity freed: dispatch again). */
export async function guardRunning(ctx: Ctx, probeHealth: boolean): Promise<boolean> {
  const rows = await ctx.db
    .select({ id: runs.id, startedAt: runs.startedAt, hosts: targets.hosts, healthPath: targets.healthPath })
    .from(runs)
    .innerJoin(targets, eq(runs.targetId, targets.id))
    .where(eq(runs.status, "running"));
  const running = new Set(rows.map((r) => r.id));
  for (const m of [healthFails, lastSeenMs]) for (const id of m.keys()) if (!running.has(id)) m.delete(id);

  let aborted = false;
  for (const r of rows) {
    if (!r.startedAt) continue;
    try {
      const outcome = (await checkTelemetry(ctx, r.id, r.startedAt)) ?? (probeHealth ? await checkHealth(ctx, r.id, r.hosts[0], r.healthPath) : null);
      if (!outcome) continue;
      await finishRun(ctx, r.id, outcome);
      aborted = true;
    } catch (e) {
      log.error("guard failed", { runId: r.id, reason: errorMessage(e) });
    }
  }
  return aborted;
}

async function checkTelemetry(ctx: Ctx, id: string, startedAt: Date): Promise<Outcome | null> {
  try {
    const last = await ctx.prom.scalar(lastPushQuery(id));
    if (last !== null) lastSeenMs.set(id, last * 1000);
  } catch (e) {
    // Prometheus unreachable counts as silence: fail closed.
    log.warn("telemetry check failed", { runId: id, reason: errorMessage(e) });
  }
  // A restarted worker starts counting from its own boot, not from the run start.
  const silence = telemetrySilenceSec(Date.now(), Math.max(startedAt.getTime(), BOOT_MS), lastSeenMs.get(id) ?? null);
  if (silence < TELEMETRY_LOSS_SEC) return null;
  return {
    status: "aborted",
    abortReason: "telemetry_lost",
    detail: `No runner telemetry for ${Math.round(silence)} s (limit ${TELEMETRY_LOSS_SEC} s); the load was stopped.`,
  };
}

async function checkHealth(ctx: Ctx, id: string, host: string, healthPath: string): Promise<Outcome | null> {
  const check = await probeTarget(ctx, host, healthPath);
  if (check.state === "pass") {
    healthFails.delete(id);
    return null;
  }
  const fails = (healthFails.get(id) ?? 0) + 1;
  healthFails.set(id, fails);
  log.warn("target health failed", { runId: id, fails, reason: check.reason });
  if (fails < HEALTH_FAILS_TO_ABORT) return null;
  return {
    status: "aborted",
    abortReason: "target_health",
    detail: `Target health failed ${fails} times in a row (${check.reason}); the load was stopped.`,
  };
}
