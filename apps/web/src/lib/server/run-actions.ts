import "server-only";

import type { PreflightResults } from "@btb/contracts";
import { APPROVAL_VALIDITY_MS } from "@btb/core/approvals";
import { writeAudit } from "@btb/core/audit";
import type { Tx } from "@btb/core/db";
import { buildVersion } from "@btb/core/env";
import { hashManifest } from "@btb/core/manifest";
import { autoApprovalRule, evaluatePlan, manifestOf, type ResolvedPlan, type RunPlanInput } from "@btb/core/policy";
import { and, eq, inArray } from "drizzle-orm";

import { db, schema } from "@/db";
import { getCatalog } from "@/lib/server/catalog";
import { enqueue } from "@/lib/server/redis";
import { getRun, loadRunDetail } from "@/lib/server/runs";
import type { SessionUser } from "@/lib/session";
import { EDITABLE, type RunRecord } from "@/lib/runs/detail";
import type { PolicyViolation, RunDetail } from "@/lib/runs/types";

/*
 * Create, Edit, Start, Stop / dequeue and Set baseline (UI-03, UI-05). The server decides; the page only explains.
 * Every change and its audit rows (the run's timeline) commit in one transaction. Start only queues: the
 * worker is the one scheduler (1 active run per target, 2 per namespace) and finishes preflight.
 */

const { approvals, baselines, runs, scenarioVersions, scenarios, targets, testDataPools } = schema;

export type ActionResult =
  | { ok: true; detail: RunDetail }
  | { ok: false; status: 404 | 409; reason: string; preflight?: PreflightResults }
  | { ok: false; status: 422; violations: PolicyViolation[] };

const actor = (u: SessionUser) => ({ id: u.id, name: u.name });
const conflict = (reason: string, preflight?: PreflightResults): ActionResult => ({ ok: false, status: 409, reason, preflight });

async function detailOf(id: string, now: Date): Promise<ActionResult> {
  const run = await getRun(id);
  return run ? { ok: true, detail: await loadRunDetail(run, now) } : { ok: false, status: 404, reason: "The run doesn't exist." };
}

/** The database ids behind a plan's names. */
async function idsOf(tx: Tx, projectId: string, plan: ResolvedPlan) {
  const [[target], [version]] = await Promise.all([
    tx.select({ id: targets.id }).from(targets).where(and(eq(targets.projectId, projectId), eq(targets.name, plan.target.id))),
    tx
      .select({ id: scenarioVersions.id })
      .from(scenarioVersions)
      .innerJoin(scenarios, eq(scenarios.id, scenarioVersions.scenarioId))
      .where(and(eq(scenarios.projectId, projectId), eq(scenarios.name, plan.scenario.name), eq(scenarioVersions.version, plan.version.version))),
  ]);
  if (!target || !version) throw new Error(`catalog changed under plan ${plan.target.id}/${plan.scenario.name}`);
  return { targetId: target.id, scenarioVersionId: version.id };
}

/** Runs no approver needs to see get a policy approval row, so the hash binding works the same way. */
async function autoApprove(tx: Tx, runId: string, plan: Pick<ResolvedPlan, "environment" | "preset">, manifestHash: string, now: Date) {
  await tx.insert(approvals).values({
    runId,
    rule: autoApprovalRule(plan.environment, plan.preset),
    manifestHash,
    decision: "approved",
    createdAt: now,
    expiresAt: new Date(now.getTime() + APPROVAL_VALIDITY_MS),
  });
}

const submitted = (approvers: number) =>
  approvers ? `Submitted for approval (${approvers} ${approvers === 1 ? "approver" : "approvers"})` : "Submitted";

/** POST /api/runs (story 1, E3.1–E3.3): policy, manifest + hash, then pending approval or auto-approved. */
export async function createRun(projectId: string, input: RunPlanInput, user: SessionUser, now: Date): Promise<ActionResult> {
  const { violations, plan } = evaluatePlan(await getCatalog(projectId), input);
  if (violations.length || !plan) return { ok: false, status: 422, violations };

  const manifest = manifestOf(projectId, plan);
  const manifestHash = hashManifest(manifest);
  const id = await db.transaction(async (tx) => {
    const ids = await idsOf(tx, projectId, plan);
    const [row] = await tx
      .insert(runs)
      .values({
        projectId,
        ...ids,
        environment: plan.environment,
        preset: plan.preset,
        network: plan.network,
        releaseId: plan.releaseId ?? null,
        status: plan.approvers ? "pending_approval" : "approved",
        manifest: manifest as unknown as Record<string, unknown>,
        manifestHash,
        durationSec: plan.durationSec,
        createdBy: user.id,
        createdAt: now,
        // The form submits on save: submitted the moment it's created.
        submittedAt: now,
        webVersion: buildVersion(),
      })
      .returning({ id: runs.id });
    if (!plan.approvers) await autoApprove(tx, row.id, plan, manifestHash, now);
    await writeAudit(
      tx,
      { actor: actor(user), action: "Created", projectId, runId: row.id },
      { actor: actor(user), action: submitted(plan.approvers), detail: `Manifest ${manifestHash.slice(0, 12)}`, projectId, runId: row.id },
      ...(plan.approvers
        ? []
        : [{ actor: null, action: "Auto-approved", detail: autoApprovalRule(plan.environment, plan.preset), projectId, runId: row.id, tone: "success" as const }]),
    );
    return row.id;
  });
  return detailOf(id, now);
}

/**
 * Edit before start (story 11): same row, new manifest and hash; earlier approvals stop counting.
 * ASSUMPTION (open question 3): Edit changes the row rather than creating a new manifest row.
 */
export async function editRun(run: RunRecord, input: RunPlanInput, user: SessionUser, now: Date): Promise<ActionResult> {
  if (!EDITABLE.has(run.status)) return conflict("Only runs that haven't started can be edited.");
  const { violations, plan } = evaluatePlan(await getCatalog(run.projectId), input);
  if (violations.length || !plan) return { ok: false, status: 422, violations };

  const manifest = manifestOf(run.projectId, plan);
  const manifestHash = hashManifest(manifest);
  // Same plan, same hash: nothing to change, and the approvals still count.
  if (manifestHash === run.manifestHash && run.status !== "draft") return detailOf(run.id, now);

  const before = await loadRunDetail(run, now);
  const voided = before.approvalRecords.filter((a) => a.byId).length;
  const updated = await db.transaction(async (tx) => {
    const ids = await idsOf(tx, run.projectId, plan);
    const [row] = await tx
      .update(runs)
      .set({
        ...ids,
        environment: plan.environment,
        preset: plan.preset,
        network: plan.network,
        releaseId: plan.releaseId ?? null,
        status: plan.approvers ? "pending_approval" : "approved",
        manifest: manifest as unknown as Record<string, unknown>,
        manifestHash,
        durationSec: plan.durationSec,
        submittedAt: now,
        preflight: null,
        queuedBehind: null,
      })
      .where(and(eq(runs.id, run.id), inArray(runs.status, [...EDITABLE] as RunRecord["status"][])))
      .returning({ id: runs.id });
    if (!row) return false;
    if (!plan.approvers) await autoApprove(tx, run.id, plan, manifestHash, now);
    await writeAudit(
      tx,
      {
        actor: actor(user),
        action: "Edited",
        detail: voided ? `New hash. ${voided} earlier ${voided === 1 ? "approval no longer counts" : "approvals no longer count"}.` : "New hash.",
        projectId: run.projectId,
        runId: run.id,
        tone: "warning",
        data: { from: run.manifestHash, to: manifestHash },
      },
      { actor: actor(user), action: submitted(plan.approvers), detail: `Manifest ${manifestHash.slice(0, 12)}`, projectId: run.projectId, runId: run.id },
      ...(plan.approvers
        ? []
        : [{ actor: null, action: "Auto-approved", detail: autoApprovalRule(plan.environment, plan.preset), projectId: run.projectId, runId: run.id, tone: "success" as const }]),
    );
    return true;
  });
  return updated ? detailOf(run.id, now) : conflict("The run changed meanwhile. Reload and try again.");
}

/**
 * The checks the web app can answer (E3.4). Target health, monitoring and runner capacity need the cluster,
 * so the worker runs them before it creates the TestRun; until then they show as pending.
 */
async function preflightOf(run: RunRecord): Promise<PreflightResults> {
  const [pool] = await db.select({ total: testDataPools.total }).from(testDataPools).where(eq(testDataPools.targetId, run.ref.targetId));
  const byWorker = { state: "pending" as const, reason: "Checked by the worker before load starts." };
  return {
    approval: { state: "pass" },
    target: { state: "pass" },
    window: { state: "pass", reason: "No blackout windows are configured yet." },
    test_data: !pool
      ? { state: "pass", reason: "This target has no test-data pool; the journey runs without test accounts." }
      : pool.total > 0
        ? { state: "pass", reason: `${pool.total} test accounts in the pool.` }
        : { state: "fail", reason: "The test-data pool has 0 accounts. Ask an admin to seed it." },
    target_health: byWorker,
    monitoring: byWorker,
    runner_capacity: byWorker,
  };
}

/** Start (stories 7, 12): re-check approval and policy, preflight, then queue for the worker. */
export async function startRun(run: RunRecord, user: SessionUser, now: Date): Promise<ActionResult> {
  const detail = await loadRunDetail(run, now);
  if (!detail.start.ok) return conflict(detail.start.reason ?? "This run can't start.");

  const preflight = await preflightOf(run);
  const failed = Object.values(preflight).filter((r) => r?.state === "fail");
  const audit = { projectId: run.projectId, runId: run.id };
  if (failed.length) {
    await db.transaction(async (tx) => {
      await tx.update(runs).set({ preflight }).where(eq(runs.id, run.id));
      await writeAudit(tx, { actor: actor(user), action: "Preflight failed", detail: failed.map((r) => r?.reason).join(" "), tone: "danger", ...audit });
    });
    return conflict("Preflight failed.", preflight);
  }

  const queued = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(runs)
      .set({ status: "queued", startRequestedAt: now, preflight, queuedBehind: null })
      .where(and(eq(runs.id, run.id), eq(runs.status, "approved"), eq(runs.manifestHash, run.manifestHash)))
      .returning({ id: runs.id });
    if (!row) return false;
    // A policy approval older than 24 h is renewed here: policy was just re-checked (detail.start), so it still holds.
    const policyRenewed = detail.approvalsRequired === 0 && !detail.approvalRecords.some((a) => a.rule && a.expiresAt > now.toISOString());
    if (policyRenewed) await autoApprove(tx, run.id, run, run.manifestHash, now);
    await writeAudit(
      tx,
      ...(policyRenewed ? [{ actor: null, action: "Auto-approved", detail: `${autoApprovalRule(run.environment, run.preset)} (renewed at start)`, tone: "success" as const, ...audit }] : []),
      { actor: actor(user), action: "Start requested", ...audit },
      { actor: null, action: "Preflight passed", detail: "Approval, target, window and test data. The worker checks the rest.", tone: "success", ...audit },
    );
    return true;
  });
  if (!queued) return conflict("The run changed meanwhile. Reload and try again.");
  await enqueue({ name: "dispatch", data: { reason: `start ${run.id}` } });
  return detailOf(run.id, now);
}

/**
 * Stop. A queued run leaves the queue and goes back to approved (it never sent load; it can be edited or started
 * again). A starting or running run gets the emergency stop (E6.2, N5): the worker deletes the TestRun and the page
 * follows the live stream until "aborted". If the worker claims a queued run meanwhile, it is stopped instead.
 */
export async function stopRun(run: RunRecord, user: SessionUser, now: Date): Promise<ActionResult> {
  if (run.status === "stopping") return detailOf(run.id, now);
  const audit = { projectId: run.projectId, runId: run.id };
  const dequeued = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(runs)
      .set({ status: "approved", queuedBehind: null, startRequestedAt: null })
      .where(and(eq(runs.id, run.id), eq(runs.status, "queued")))
      .returning({ id: runs.id });
    if (!row) return false;
    await writeAudit(tx, { actor: actor(user), action: "Removed from queue", detail: "No load was sent. Start it again or edit it.", tone: "warning", ...audit });
    return true;
  });
  if (dequeued) {
    // The runs behind it move up.
    await enqueue({ name: "dispatch", data: { reason: `dequeue ${run.id}` } });
    return detailOf(run.id, now);
  }

  const stopped = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(runs)
      .set({ status: "stopping" })
      .where(and(eq(runs.id, run.id), inArray(runs.status, ["starting", "running"])))
      .returning({ id: runs.id });
    if (!row) return false;
    await writeAudit(tx, {
      actor: actor(user),
      action: "Emergency stop",
      detail: "TestRun deleted; runner pods stopping.",
      tone: "danger",
      ...audit,
    });
    return true;
  });
  if (!stopped) return conflict(`The run is ${run.status.replace("_", " ")}, so there is nothing to stop.`);
  await enqueue({ name: "stop", data: { runId: run.id } });
  return detailOf(run.id, now);
}

/** Pin a completed run as the baseline for its target + scenario + preset (story 36). */
export async function setBaseline(run: RunRecord, user: SessionUser, now: Date): Promise<ActionResult> {
  const before = await loadRunDetail(run, now);
  if (!before.canBaseline) return conflict("Only a completed run with results can be the baseline.");
  if (before.baseline?.isThis) return { ok: true, detail: before };

  await db.transaction(async (tx) => {
    await tx
      .insert(baselines)
      .values({ targetId: run.ref.targetId, scenarioId: run.ref.scenarioId, preset: run.preset, runId: run.id, setBy: user.id, setAt: now })
      .onConflictDoUpdate({ target: [baselines.targetId, baselines.scenarioId, baselines.preset], set: { runId: run.id, setBy: user.id, setAt: now } });
    await writeAudit(tx, {
      actor: actor(user),
      action: "Set as baseline",
      detail: `For ${run.scenario.name} (${run.preset}) on ${run.target.name}${before.baseline ? `, replacing ${before.baseline.runId}` : ""}.`,
      tone: "info",
      projectId: run.projectId,
      runId: run.id,
    });
  });
  return detailOf(run.id, now);
}
