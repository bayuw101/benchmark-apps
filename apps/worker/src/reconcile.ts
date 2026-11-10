import { ACTIVE_STATUSES, K6_SCRIPT_ABORTED_EXIT, type RunnerCallback } from "@btb/contracts";
import { writeAudit } from "@btb/core/audit";
import { auditLogs, environments, runs } from "@btb/core/db";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";

import type { Executor, RunnerExit } from "@btb/core/executor";

import { placement, type Ctx } from "./context";
import { finishRun } from "./finish";
import { kubeErrorMessage } from "./kube";
import { log } from "./log";
import { outcomeOf, selfCheckRefusal, withCallbacks, type Outcome } from "./plan";

/*
 * Reconcile (every tick): move active runs along with their executor status (TestRun stage, or Docker
 * containers), end them when the runners are done, and delete runners no active run owns. Call under the
 * worker lock.
 */

/** PROPOSAL: a run still `starting` after this long failed to start (image pull, quota, operator down). */
export const STARTING_TIMEOUT_SEC = 5 * 60;
/** PROPOSAL: a `running` run this long past its planned duration is stuck; the TestRun is deleted. */
export const OVERRUN_GRACE_SEC = 10 * 60;

const failed = (detail: string): Outcome => ({ status: "failed", abortReason: "kubernetes_failure", detail });

interface ActiveRow {
  id: string;
  projectId: string;
  status: string;
  environment: string;
  namespace: string;
  startedAt: Date | null;
  updatedAt: Date;
  durationSec: number;
}

/** True when a run ended (capacity freed: dispatch again). */
export async function reconcile(ctx: Ctx): Promise<boolean> {
  const active: ActiveRow[] = await ctx.db
    .select({
      id: runs.id,
      projectId: runs.projectId,
      status: runs.status,
      environment: runs.environment,
      namespace: environments.namespace,
      startedAt: runs.startedAt,
      updatedAt: runs.updatedAt,
      durationSec: runs.durationSec,
    })
    .from(runs)
    .innerJoin(environments, eq(runs.environment, environments.id))
    .where(inArray(runs.status, [...ACTIVE_STATUSES]));

  let ended = false;
  for (const r of active) {
    try {
      if (await reconcileRun(ctx, r)) ended = true;
    } catch (e) {
      log.error("reconcile failed", { runId: r.id, reason: kubeErrorMessage(e) });
    }
  }
  await sweepOrphans(ctx, new Set(active.map((r) => r.id)));
  return ended;
}

async function reconcileRun(ctx: Ctx, r: ActiveRow): Promise<boolean> {
  if (r.status === "stopping") return stopRun(ctx, r.id);

  const { executor, scope } = placement(ctx, r.environment, r.namespace);
  const st = await executor.status(scope, r.id);
  if (!st) {
    await finishRun(ctx, r.id, failed(`The runners of ${r.id} are gone from ${scope} (${executor.kind}).`));
    return true;
  }
  const now = Date.now();

  switch (st.stage) {
    case "failed":
      // The runners still alive (another pod, a k6-operator error) stop now, not at the next orphan sweep.
      await executor.delete(scope, r.id);
      await finishRun(ctx, r.id, failed(st.detail ?? `The ${executor.kind} executor reported a failure.`));
      return true;

    case "finished": {
      const pods = st.runners;
      const { outcome: judged, missing } = withCallbacks(
        outcomeOf(pods.map((p) => p.exitCode)),
        await runnerCallbacks(ctx, r.id),
        pods.map((p) => p.name),
      );
      const outcome = judged.abortReason === "lease_expired" ? await refusedInLog(executor, scope, pods, judged) : judged;
      // A short run can finish between two ticks; then it started when it was claimed.
      if (r.status === "starting" && outcome.abortReason !== "policy_breach") await markRunning(ctx, r, r.updatedAt);
      if (missing.length) {
        await writeAudit(ctx.db, {
          actor: null,
          action: "Result callback missing",
          detail: `No signed result from ${missing.join(", ")}; judged without it.`,
          tone: "warning",
          projectId: r.projectId,
          runId: r.id,
        });
      }
      let data: Record<string, unknown> | undefined;
      if (outcome.status === "failed") {
        const bad = pods.find((p) => p.exitCode !== 0);
        if (bad) data = { pod: bad.name, logTail: await executor.logTail(scope, bad.name, 20) };
      }
      await finishRun(ctx, r.id, outcome, data);
      return true;
    }

    case "running":
      if (r.status === "starting") {
        await markRunning(ctx, r, new Date());
        return false;
      }
      if (r.startedAt && now > r.startedAt.getTime() + (r.durationSec + OVERRUN_GRACE_SEC) * 1000) {
        await executor.delete(scope, r.id);
        await finishRun(ctx, r.id, failed(`Still running ${OVERRUN_GRACE_SEC / 60} min past its planned length; the runners were deleted.`));
        return true;
      }
      return false;

    case "pending":
      if (r.status === "starting" && now > r.updatedAt.getTime() + STARTING_TIMEOUT_SEC * 1000) {
        await executor.delete(scope, r.id);
        await finishRun(ctx, r.id, failed(`Runners did not start within ${STARTING_TIMEOUT_SEC / 60} min (${st.detail ?? executor.kind}).`));
        return true;
      }
      return false;
  }
}

/** Runner callbacks of a run (written by the web app's /api/runner/callback), oldest first. */
async function runnerCallbacks(ctx: Ctx, runId: string): Promise<RunnerCallback[]> {
  const rows = await ctx.db
    .select({ data: auditLogs.data })
    .from(auditLogs)
    .where(and(eq(auditLogs.runId, runId), isNotNull(sql`${auditLogs.data}->>'callback'`)))
    .orderBy(auditLogs.at);
  return rows.map(({ data }) => {
    const d = data as Record<string, unknown>;
    return { ...d, runId, event: d.callback } as RunnerCallback;
  });
}

/** A runner that refused in setup() but couldn't report it (platform unreachable) still left its k6 summary in the log. */
async function refusedInLog(executor: Executor, scope: string, pods: RunnerExit[], outcome: Outcome): Promise<Outcome> {
  for (const p of pods.filter((x) => x.exitCode === K6_SCRIPT_ABORTED_EXIT)) {
    const reason = selfCheckRefusal(await executor.logTail(scope, p.name, 200));
    if (reason) {
      return { status: "aborted", abortReason: "policy_breach", detail: `A runner refused to start, no load was sent: ${reason} (from its log; the callback didn't arrive).` };
    }
  }
  return outcome;
}

async function markRunning(ctx: Ctx, r: ActiveRow, at: Date) {
  await ctx.db.transaction(async (tx) => {
    const done = await tx
      .update(runs)
      .set({ status: "running", startedAt: at, updatedAt: new Date() })
      .where(and(eq(runs.id, r.id), eq(runs.status, "starting")))
      .returning({ id: runs.id });
    if (!done.length) return;
    await writeAudit(tx, { actor: null, action: "Runners started", detail: "Runners run their self-check, then send load.", tone: "info", projectId: r.projectId, runId: r.id });
  });
  log.info("run running", { runId: r.id });
}

/** Emergency stop (E8.3): delete the runners (TestRun with its pods, or the containers), then end the run as aborted. */
export async function stopRun(ctx: Ctx, id: string): Promise<boolean> {
  const [r] = await ctx.db
    .select({ status: runs.status, environment: runs.environment, namespace: environments.namespace })
    .from(runs)
    .innerJoin(environments, eq(runs.environment, environments.id))
    .where(eq(runs.id, id));
  if (r?.status !== "stopping") return false;
  const { executor, scope } = placement(ctx, r.environment, r.namespace);
  const existed = await executor.delete(scope, id);
  await finishRun(ctx, id, {
    status: "aborted",
    abortReason: "emergency_stop",
    detail: existed ? (executor.kind === "kubernetes" ? "TestRun deleted; its runner pods are removed with it." : "Runner containers removed.") : "No runners were running.",
  });
  return true;
}

/** Runners labelled with a run id that is no longer active (ended, or a crash between steps). */
async function sweepOrphans(ctx: Ctx, activeIds: Set<string>) {
  const envs = await ctx.db.select({ id: environments.id, namespace: environments.namespace }).from(environments);
  for (const env of envs) {
    const { executor, scope } = placement(ctx, env.id, env.namespace);
    try {
      for (const o of await executor.owned(scope)) {
        if (o.deleting || activeIds.has(o.runId)) continue;
        await executor.delete(scope, o.runId);
        log.info("orphan runners deleted", { executor: executor.kind, scope, runId: o.runId });
      }
    } catch (e) {
      log.warn("orphan sweep failed", { executor: executor.kind, scope, reason: kubeErrorMessage(e) });
    }
  }
}
