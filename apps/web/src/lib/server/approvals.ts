import "server-only";

import { writeAudit } from "@btb/core/audit";
import type { Tx } from "@btb/core/db";
import { and, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import { getCatalog } from "@/lib/server/catalog";
import { getRun, listRuns, loadRunDetail } from "@/lib/server/runs";
import { approvalProblem, needsReview, stateOf, type ReviewItem } from "@/lib/runs/review";
import { atLeast, type SessionUser } from "@/lib/session";
import { APPROVAL_VALIDITY_MS, forHash, validApprovals } from "@btb/core/approvals";
import { approversFor } from "@btb/core/policy";

import type { RunRecord } from "@/lib/runs/detail";
import type { PolicyViolation, RunDetail } from "@/lib/runs/types";

/*
 * Approvals (UI-08, PRD E4.2–E4.5, stories 9–13). Enforced here, on the server; the inbox only explains.
 * Each approval names the manifest hash it was given for, so an edit voids it without deleting anything.
 */

const { approvals, runs } = schema;

/** Runs in the project that need an approval: waiting, partly approved, edited since approval, or expired. */
export async function approvalInbox(user: SessionUser, projectId: string, now: Date): Promise<ReviewItem[]> {
  const [candidates, catalog] = await Promise.all([reviewCandidates(projectId), getCatalog(projectId)]);
  const items = await Promise.all(candidates.map(async (run) => ({ run, detail: await loadRunDetail(run, now, catalog) })));
  return items
    .filter(({ detail }) => needsReview(detail))
    .map(({ run, detail }) => {
      const reason = approvalProblem(detail, run.ref.createdById, user, now) ?? undefined;
      return { detail, state: stateOf(detail), canApprove: !reason, reason };
    });
}

/** Runs that may need an approver: waiting, or approved by people whose approvals can expire. */
async function reviewCandidates(projectId: string) {
  const rows = await listRuns(and(eq(runs.projectId, projectId), inArray(runs.status, ["pending_approval", "approved"])));
  return rows.filter((r) => approversFor(r.environment, r.preset) > 0);
}

/**
 * The nav badge: runs this user could approve now. Same rules as the inbox (approvalProblem), from two queries
 * instead of a full detail per run, because the layout asks on every navigation.
 */
export async function reviewCount(user: SessionUser, projectId: string, now: Date): Promise<number> {
  if (!atLeast(user.role, "approver")) return 0;
  const candidates = (await reviewCandidates(projectId)).filter((r) => r.ref.createdById !== user.id);
  if (!candidates.length) return 0;
  const rows = await db
    .select({ runId: approvals.runId, userId: approvals.userId, manifestHash: approvals.manifestHash, decision: approvals.decision, expiresAt: approvals.expiresAt })
    .from(approvals)
    .where(inArray(approvals.runId, candidates.map((r) => r.id)));
  return candidates.filter((r) => {
    const current = forHash(rows.filter((a) => a.runId === r.id), r.manifestHash);
    const expired = current.some((a) => !a.expiresAt || a.expiresAt <= now);
    const waiting = r.status === "pending_approval" || (r.status === "approved" && expired);
    const approvedByMe = validApprovals(current, r.manifestHash, now).some((a) => a.userId === user.id);
    return waiting && !approvedByMe;
  }).length;
}

export type ApprovalResult = { ok: true; detail: RunDetail } | { ok: false; status: 409; reason: string } | { ok: false; status: 422; violations: PolicyViolation[] };

const changed: ApprovalResult = { ok: false, status: 409, reason: "The run changed meanwhile. Reload and review it again." };

/** Locks the run row and checks it's still the version that was reviewed. */
async function lockReviewed(tx: Tx, run: RunRecord) {
  const [row] = await tx.select({ status: runs.status, manifestHash: runs.manifestHash }).from(runs).where(eq(runs.id, run.id)).for("update");
  return row?.manifestHash === run.manifestHash && (row.status === "pending_approval" || row.status === "approved") ? row : null;
}

/** Records an approval for the current hash, valid 24 h. Enough approvals = approved (and re-approved when expired). */
export async function approveRun(run: RunRecord, user: SessionUser, now: Date): Promise<ApprovalResult> {
  const before = await loadRunDetail(run, now);
  const problem = approvalProblem(before, run.ref.createdById, user, now);
  if (problem) return { ok: false, status: 409, reason: problem };

  const expiresAt = new Date(now.getTime() + APPROVAL_VALIDITY_MS);
  const ok = await db.transaction(async (tx) => {
    const row = await lockReviewed(tx, run);
    if (!row) return false;
    // An expired approval from the same person is renewed, not counted twice.
    await tx
      .insert(approvals)
      .values({ runId: run.id, userId: user.id, manifestHash: run.manifestHash, decision: "approved", createdAt: now, expiresAt })
      .onConflictDoUpdate({
        target: [approvals.runId, approvals.userId, approvals.manifestHash],
        targetWhere: sql`${approvals.decision} = 'approved'`,
        set: { createdAt: now, expiresAt },
      });
    const valid = await tx
      .select({ userId: approvals.userId })
      .from(approvals)
      .where(
        and(
          eq(approvals.runId, run.id),
          eq(approvals.manifestHash, run.manifestHash),
          eq(approvals.decision, "approved"),
          isNotNull(approvals.userId),
          gt(approvals.expiresAt, now),
        ),
      );
    const done = valid.length >= before.approvalsRequired;
    if (done && row.status === "pending_approval") await tx.update(runs).set({ status: "approved" }).where(eq(runs.id, run.id));
    await writeAudit(tx, {
      actor: { id: user.id, name: user.name },
      action: "Approved",
      detail: `${Math.min(valid.length, before.approvalsRequired)} of ${before.approvalsRequired} for manifest ${run.manifestHash.slice(0, 12)}.`,
      tone: "success",
      projectId: run.projectId,
      runId: run.id,
    });
    return true;
  });
  if (!ok) return changed;
  const fresh = await getRun(run.id);
  return { ok: true, detail: await loadRunDetail(fresh ?? run, now) };
}

/** Rejects with a reason the engineer will read. The run can't start; they create a new one. */
export async function rejectRun(run: RunRecord, user: SessionUser, note: unknown, now: Date): Promise<ApprovalResult> {
  const before = await loadRunDetail(run, now);
  if (!atLeast(user.role, "approver")) return { ok: false, status: 409, reason: "Only approvers can reject runs." };
  if (!needsReview(before)) return { ok: false, status: 409, reason: "This run isn't waiting for an approval." };
  if (run.ref.createdById === user.id) return { ok: false, status: 409, reason: "You created this run. Edit it instead of rejecting it." };
  const text = typeof note === "string" ? note.trim() : "";
  if (text.length < 5 || text.length > 300) {
    return { ok: false, status: 422, violations: [{ field: "note", rule: "length", message: "Tell the engineer why, in 5–300 characters." }] };
  }

  const ok = await db.transaction(async (tx) => {
    if (!(await lockReviewed(tx, run))) return false;
    await tx.insert(approvals).values({ runId: run.id, userId: user.id, manifestHash: run.manifestHash, decision: "rejected", note: text, createdAt: now });
    await tx.update(runs).set({ status: "rejected" }).where(eq(runs.id, run.id));
    await writeAudit(tx, { actor: { id: user.id, name: user.name }, action: "Rejected", detail: text, tone: "danger", projectId: run.projectId, runId: run.id });
    return true;
  });
  return ok ? { ok: true, detail: await loadRunDetail({ ...run, status: "rejected" }, now) } : changed;
}
