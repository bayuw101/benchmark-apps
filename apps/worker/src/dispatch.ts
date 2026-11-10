import { ACTIVE_STATUSES, RUNNER_PROTOCOL, type PreflightKey, type PreflightResults, type RunManifest } from "@btb/contracts";
import { approvalsSatisfied } from "@btb/core/approvals";
import { writeAudit } from "@btb/core/audit";
import { approvals, environments, isUniqueViolation, runnerImages, runs, targets, testDataPools } from "@btb/core/db";
import { buildVersion } from "@btb/core/env";
import { isLocalHost, type ExecutionSpec, type Executor } from "@btb/core/executor";
import { leaseToken } from "@btb/core/lease";
import { hashManifest } from "@btb/core/manifest";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { placement, type Ctx } from "./context";
import { finishRun } from "./finish";
import { seedTestData } from "./hooks";
import { kubeErrorMessage, withTimeout } from "./kube";
import { errorMessage, log } from "./log";
import {
  clusterService,
  LEASE_EVERY_SEC,
  LEASE_GRACE_SEC,
  parallelismFor,
  runnerConfig,
  runnerImage,
  schedule,
  targetUrl,
  tokenExpiry,
} from "./plan";

/*
 * Dispatch (E3.5): start queued runs in start-request order while capacity allows, after the worker half
 * of preflight (E3.4). Idempotent; call it under the worker lock.
 */

const MAX_PASSES = 5;

export async function dispatch(ctx: Ctx) {
  // A run that fails preflight gives its slot back; the runs behind it get another pass.
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    if (await dispatchPass(ctx)) return;
  }
}

/** True when nothing is left to retry in this round. */
async function dispatchPass(ctx: Ctx): Promise<boolean> {
  const rows = await ctx.db
    .select({ id: runs.id, status: runs.status, targetId: runs.targetId, namespace: environments.namespace, queuedBehind: runs.queuedBehind })
    .from(runs)
    .innerJoin(environments, eq(runs.environment, environments.id))
    .where(inArray(runs.status, ["queued", ...ACTIVE_STATUSES]))
    .orderBy(asc(runs.startRequestedAt), asc(runs.id));
  const queued = rows.filter((r) => r.status === "queued");
  if (!queued.length) return true;
  const active = rows.filter((r) => r.status !== "queued");

  let settled = true;
  for (const d of schedule(queued, active, ctx.cfg.perNamespace)) {
    if (d.start) {
      if (!(await startRun(ctx, d.id))) settled = false;
      continue;
    }
    const row = queued.find((q) => q.id === d.id);
    if (row?.queuedBehind !== d.behind) {
      await ctx.db
        .update(runs)
        .set({ queuedBehind: d.behind, updatedAt: new Date() })
        .where(and(eq(runs.id, d.id), eq(runs.status, "queued")));
    }
  }
  return settled;
}

const CHECK_LABEL: Partial<Record<PreflightKey, string>> = {
  approval: "Approval",
  target: "Target",
  target_health: "Target health",
  monitoring: "Monitoring",
  runner_capacity: "Runner capacity",
  test_data: "Test data",
};

export type Check = NonNullable<PreflightResults[PreflightKey]>;
const pass = (reason: string): Check => ({ state: "pass", reason });
const fail = (reason: string): Check => ({ state: "fail", reason });

/** Preflight, claim (queued -> starting), create the TestRun. True if the run is now starting. */
async function startRun(ctx: Ctx, id: string): Promise<boolean> {
  const [row] = await ctx.db
    .select({ run: runs, namespace: environments.namespace, target: targets, protocol: runnerImages.protocol, poolTotal: testDataPools.total })
    .from(runs)
    .innerJoin(environments, eq(runs.environment, environments.id))
    .innerJoin(targets, eq(runs.targetId, targets.id))
    .leftJoin(testDataPools, eq(testDataPools.targetId, runs.targetId))
    .leftJoin(runnerImages, eq(runnerImages.tag, sql`${runs.manifest}->'scenario'->>'imageVersion'`))
    .where(eq(runs.id, id));
  if (row?.run.status !== "queued") return false;
  const { run, namespace, target, protocol, poolTotal } = row;
  const manifest = run.manifest as unknown as RunManifest;
  const audit = { projectId: run.projectId, runId: id };
  const { executor, scope } = placement(ctx, run.environment, namespace);
  const docker = executor.kind === "docker";

  const parallelism = parallelismFor(manifest.load.target, Math.min(ctx.cfg.maxParallelism, executor.maxRunners));
  const image = runnerImage(ctx.cfg.runnerRegistry, manifest.scenario.imageVersion);
  let checks: PreflightResults;
  let body: ExecutionSpec | null = null;
  try {
    const token = leaseToken(ctx.cfg.leaseSecret, id, tokenExpiry(Date.now(), manifest.load.durationSec));
    const lease = { url: docker ? ctx.cfg.docker.leaseUrl : ctx.cfg.runnerLeaseUrl, token, everySec: LEASE_EVERY_SEC, graceSec: LEASE_GRACE_SEC };
    const config = runnerConfig(id, run.manifestHash, manifest, target, parallelism, lease, poolTotal);
    body = { runId: id, scope, image, runners: parallelism, config, remoteWriteUrl: docker ? ctx.cfg.docker.remoteWriteUrl : ctx.cfg.runnerRemoteWriteUrl };
    // Policy already refuses these; this catches runs queued before the image was marked.
    const approval =
      (protocol ?? 0) < RUNNER_PROTOCOL
        ? fail(`Runner image ${manifest.scenario.imageVersion} can't check its own manifest before load. Save a new scenario version on the current image.`)
        : await approvalCheck(ctx, run);
    checks = { approval, ...(await workerPreflight(ctx, executor, scope, target, parallelism, manifest.network !== null)) };
    // The identities are a Secret mounted into runner pods; Docker runs have no such mount.
    if (docker && poolTotal !== null) checks.test_data = fail("This target has a test-data pool, which needs the Kubernetes executor (its Secret is mounted into runner pods).");
  } catch (e) {
    checks = { target: fail(errorMessage(e)) };
  }
  // Seed last, so a run that can't start doesn't touch the target's data.
  if (body && !Object.values(checks).some((c) => c.state === "fail")) {
    const seeded = await seedTestData(ctx, target.id);
    if (seeded) checks = { ...checks, test_data: seeded };
  }

  const preflight: PreflightResults = { ...run.preflight, ...checks };
  const failed = Object.entries(checks).filter(([, c]) => c.state === "fail") as [PreflightKey, Check][];
  if (failed.length || !body) {
    await ctx.db.transaction(async (tx) => {
      const back = await tx
        .update(runs)
        .set({ status: "approved", preflight, queuedBehind: null, updatedAt: new Date() })
        .where(and(eq(runs.id, id), eq(runs.status, "queued")))
        .returning({ id: runs.id });
      if (!back.length) return;
      await writeAudit(tx, {
        actor: null,
        action: "Preflight failed",
        detail: failed.map(([k, c]) => `${CHECK_LABEL[k] ?? k}: ${c.reason}`).join(" "),
        tone: "danger",
        ...audit,
      });
    });
    log.warn("preflight failed", { runId: id, failed: Object.fromEntries(failed.map(([k, c]) => [k, c.reason])) });
    return false;
  }

  const spec = body;
  let claimed = false;
  try {
    claimed = await ctx.db.transaction(async (tx) => {
      const done = await tx
        .update(runs)
        .set({ status: "starting", preflight, queuedBehind: null, workerVersion: buildVersion(), updatedAt: new Date() })
        .where(and(eq(runs.id, id), eq(runs.status, "queued")))
        .returning({ id: runs.id });
      if (!done.length) return false;
      await writeAudit(
        tx,
        { actor: null, action: "Preflight passed", detail: checks.test_data ? "Target health, monitoring, runner capacity and test data." : "Target health, monitoring and runner capacity.", tone: "success", ...audit },
        {
          actor: null,
          action: "Starting",
          detail: executor.describe(spec),
          tone: "info",
          data: { executor: executor.kind, scope, runners: parallelism, image },
          ...audit,
        },
      );
      return true;
    });
  } catch (e) {
    // The per-target unique index: something else holds the target. Stay queued.
    if (isUniqueViolation(e)) return false;
    throw e;
  }
  if (!claimed) return false;

  try {
    await executor.create(spec);
  } catch (e) {
    const reason = kubeErrorMessage(e);
    log.error("runner create failed", { runId: id, executor: executor.kind, reason });
    await finishRun(ctx, id, { status: "failed", abortReason: "kubernetes_failure", detail: `Could not start the runners (${executor.kind}): ${reason}` });
    return false;
  }
  log.info("run starting", { runId: id, executor: executor.kind, scope, runners: parallelism, image });
  return true;
}

/**
 * The worker doesn't take the web app's word for it (PRD: Start re-checks approvals; E3.2): the stored manifest
 * must still hash to the hash that was approved, and the approvals for that hash must be enough. Expiry was
 * checked when Start was pressed; a run approved then may wait in the queue.
 */
async function approvalCheck(ctx: Ctx, run: typeof runs.$inferSelect): Promise<Check> {
  if (hashManifest(run.manifest) !== run.manifestHash) return fail("The stored manifest doesn't match its approved hash. It was changed outside the app.");
  const rows = await ctx.db
    .select({ userId: approvals.userId, manifestHash: approvals.manifestHash, decision: approvals.decision, expiresAt: approvals.expiresAt })
    .from(approvals)
    .where(eq(approvals.runId, run.id));
  const environment = run.environment as RunManifest["environment"];
  const ok = approvalsSatisfied({ environment, preset: run.preset, manifestHash: run.manifestHash, createdById: run.createdBy }, rows);
  return ok ? pass(`Manifest ${run.manifestHash.slice(0, 12)} matches its approvals.`) : fail("Not enough approvals for this manifest.");
}

async function workerPreflight(
  ctx: Ctx,
  executor: Executor,
  scope: string,
  target: { hosts: string[]; healthPath: string },
  parallelism: number,
  browser: boolean,
): Promise<PreflightResults> {
  // E5.5: the Docker executor never sends load to anything but this machine.
  const remote = executor.kind === "docker" ? target.hosts.filter((h) => !isLocalHost(h)) : [];
  if (remote.length) return { target: fail(`This environment runs on the Docker executor (local development), which only loads loopback targets; ${remote.join(", ")} isn't one.`) };
  const runners = `${parallelism} runner${parallelism === 1 ? "" : "s"}`;
  const [monitoring, runnerCapacity, targetHealth] = await Promise.all([
    ctx.prom.ready().then((ok) => (ok ? pass("Prometheus is ready.") : fail("Prometheus is not ready."))),
    executor.capacity(scope, parallelism, browser).then(
      (short) => (short ? fail(short) : pass(`Room for ${runners} (${executor.kind}, ${scope}).`)),
      (e) => fail(`Could not check runner capacity in ${scope}: ${kubeErrorMessage(e)}`),
    ),
    probeTarget(ctx, target.hosts[0], target.healthPath),
  ]);
  return { monitoring, runner_capacity: runnerCapacity, target_health: targetHealth };
}

const HEALTH_TIMEOUT_MS = 5000;

export async function probeTarget(ctx: Ctx, host: string, healthPath: string): Promise<Check> {
  const where = `${host}${healthPath}`;
  try {
    const svc = clusterService(host);
    if (svc) {
      // The worker isn't on the cluster network: go through the API server's service proxy.
      await withTimeout(ctx.kube.serviceGet(svc.namespace, svc.name, svc.port, healthPath), HEALTH_TIMEOUT_MS, "Health probe");
    } else {
      const res = await fetch(`${targetUrl(host)}${healthPath}`, { redirect: "manual", signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }
    return pass(`${where} answered.`);
  } catch (e) {
    return fail(`${where} did not answer (${kubeErrorMessage(e)}).`);
  }
}
