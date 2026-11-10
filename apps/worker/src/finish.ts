import { ACTIVE_STATUSES, type RunManifest, type Tone } from "@btb/contracts";
import { writeAudit } from "@btb/core/audit";
import { environments, runs, runSummaries, targets } from "@btb/core/db";
import { integrityClean, type IntegrityCounts } from "@btb/core/integrity";
import { and, eq, inArray, lte, max, ne } from "drizzle-orm";
import { setTimeout as sleep } from "node:timers/promises";

import { collectArtifacts } from "./artifacts";
import { placement, type Ctx } from "./context";
import { cleanupTestData } from "./hooks";
import { kubeErrorMessage } from "./kube";
import { httpIntegrityAdapter } from "./integrity";
import { errorMessage, log } from "./log";
import { caveatsOf, PUSH_INTERVAL_SEC, saturationOf, verdictOf, type Outcome, type SummaryNumbers } from "./plan";
import { saturation, summarize } from "./summary";

/**
 * After an emergency stop the runners are already deleted; k6 flushes its last push on SIGTERM, which can land a
 * push interval after the end (RUN-0188: peak RPS 26 instead of 28). Wait for it before reading the summary.
 */
const FINAL_PUSH_WAIT_MS = (PUSH_INTERVAL_SEC + 1) * 1000;

/**
 * Ends an active run: summary from Prometheus, verdict + caveats, status, timeline, then the TestRun is
 * deleted. A no-op if the run already ended. Call under the worker lock.
 */
export async function finishRun(ctx: Ctx, id: string, outcome: Outcome, data?: Record<string, unknown>) {
  const [row] = await ctx.db
    .select({ run: runs, namespace: environments.namespace, hosts: targets.hosts, integrityPath: targets.integrityPath })
    .from(runs)
    .innerJoin(environments, eq(runs.environment, environments.id))
    .innerJoin(targets, eq(runs.targetId, targets.id))
    .where(eq(runs.id, id));
  if (!row || !(ACTIVE_STATUSES as readonly string[]).includes(row.run.status)) return;
  const { run, namespace } = row;
  const manifest = run.manifest as unknown as RunManifest;
  const endedAt = new Date();
  const { executor, scope } = placement(ctx, run.environment, namespace);
  const browser = manifest.network !== null;

  let summary: SummaryNumbers | null = null;
  let saturated: string | null = null;
  if (run.startedAt) {
    let evalAt = endedAt;
    if (outcome.abortReason === "emergency_stop") {
      evalAt = new Date(endedAt.getTime() + FINAL_PUSH_WAIT_MS);
      await sleep(FINAL_PUSH_WAIT_MS);
    }
    try {
      summary = await summarize(ctx.prom, id, run.startedAt, endedAt, manifest.load.model, browser, evalAt);
    } catch (e) {
      log.warn("summary failed", { runId: id, reason: errorMessage(e) });
    }
    try {
      if (summary) saturated = saturationOf(await saturation(ctx.prom, id, run.startedAt, evalAt, executor === ctx.executors.kubernetes ? namespace : null, browser));
    } catch (e) {
      log.warn("saturation check failed", { runId: id, reason: errorMessage(e) });
    }
  }
  let checked: Awaited<ReturnType<typeof checkIntegrity>> = null;
  if (summary && run.startedAt) {
    // Runs on one target never overlap, but the lead could reach into the previous run's window.
    const [prev] = await ctx.db
      .select({ endedAt: max(runs.endedAt) })
      .from(runs)
      .where(and(eq(runs.targetId, run.targetId), ne(runs.id, id), lte(runs.endedAt, run.startedAt)));
    const from = new Date(Math.max(run.startedAt.getTime() - INTEGRITY_LEAD_MS, prev?.endedAt?.getTime() ?? 0));
    checked = await checkIntegrity(ctx, id, row.hosts[0], row.integrityPath, from, endedAt);
  }
  const integrity = checked?.counts ?? null;
  const verdict = verdictOf(outcome, summary, manifest.thresholds, integrity);
  const caveats = caveatsOf(outcome, summary, integrity, saturated);

  await ctx.db.transaction(async (tx) => {
    const done = await tx
      .update(runs)
      .set({ status: outcome.status, abortReason: outcome.abortReason, endedAt, verdict, caveats, queuedBehind: null, updatedAt: endedAt })
      .where(and(eq(runs.id, id), inArray(runs.status, [...ACTIVE_STATUSES])))
      .returning({ id: runs.id });
    if (!done.length) return;
    if (summary) await tx.insert(runSummaries).values({ runId: id, ...summary, ...integrity }).onConflictDoNothing();
    if (checked) await writeAudit(tx, { actor: null, ...checked.entry, projectId: run.projectId, runId: id, data: { integrity } });
    if (saturated) await writeAudit(tx, { actor: null, action: "Generator saturated", detail: saturated, tone: "warning", projectId: run.projectId, runId: id });
    await writeAudit(tx, { actor: null, ...endEntry(outcome, verdict, summary), projectId: run.projectId, runId: id, data: { ...data, verdict, caveats } });
  });

  await collectArtifacts(executor, ctx, id, scope);
  try {
    await executor.delete(scope, id);
  } catch (e) {
    // The orphan sweep retries.
    log.warn("runner delete failed", { runId: id, executor: executor.kind, reason: kubeErrorMessage(e) });
  }
  await cleanupTestData(ctx, run);
  log.info("run finished", { runId: id, status: outcome.status, abortReason: outcome.abortReason, verdict, caveats });
}

/** Same lead as the summary window: startedAt is when the worker saw the TestRun start. */
const INTEGRITY_LEAD_MS = 30_000;

type Entry = { action: string; detail: string; tone: Tone };

/** Null when the target has no integrity source (the caveat says so); otherwise counts (or null on failure) and a timeline entry. */
async function checkIntegrity(ctx: Ctx, id: string, host: string | undefined, path: string | null, from: Date, to: Date): Promise<{ counts: IntegrityCounts | null; entry: Entry } | null> {
  if (!path || !host) return null;
  const adapter = httpIntegrityAdapter(ctx, host, path);
  try {
    const counts = await adapter.check({ from, to });
    const detail = `${counts.oversoldSeats} oversold seats, ${counts.doubleCharges} double charges, ${counts.chargedNoTicket} charged without a ticket (${adapter.source}).`;
    return { counts, entry: integrityClean(counts) ? { action: "Integrity verified", detail, tone: "success" } : { action: "Integrity broken", detail, tone: "danger" } };
  } catch (e) {
    log.warn("integrity check failed", { runId: id, source: adapter.source, reason: errorMessage(e) });
    return { counts: null, entry: { action: "Integrity not verified", detail: `${adapter.source} didn't answer: ${errorMessage(e)}.`, tone: "warning" } };
  }
}

function endEntry(outcome: Outcome, verdict: "pass" | "fail" | null, s: SummaryNumbers | null): { action: string; detail: string; tone: Tone } {
  const numbers = s ? ` p95 ${s.p95Ms} ms, errors ${s.errorRatePct}%, peak ${s.peakRps} RPS.` : "";
  switch (outcome.abortReason) {
    case null:
      return {
        action: "Completed",
        detail: verdict ? `Verdict: ${verdict}.${numbers}` : `No verdict: no telemetry.${numbers}`,
        tone: verdict === "pass" ? "success" : verdict === "fail" ? "danger" : "warning",
      };
    case "threshold":
      return { action: "Aborted: threshold crossed", detail: `${outcome.detail}${numbers}`, tone: "danger" };
    case "emergency_stop":
      return { action: "Stopped", detail: `${outcome.detail}${numbers}`, tone: "warning" };
    case "target_health":
      return { action: "Aborted: target unhealthy", detail: `${outcome.detail}${numbers}`, tone: "danger" };
    case "telemetry_lost":
      return { action: "Aborted: telemetry lost", detail: outcome.detail, tone: "danger" };
    case "lease_expired":
      return { action: "Aborted: runner lease lost", detail: `${outcome.detail}${numbers}`, tone: "danger" };
    case "policy_breach":
      return { action: "Aborted: runner refused to start", detail: outcome.detail, tone: "danger" };
    default:
      return { action: outcome.status === "aborted" ? "Aborted" : "Failed", detail: outcome.detail, tone: "danger" };
  }
}
