import { atLeast, type SessionUser } from "@/lib/session";
import type { RunDetail } from "./types";

/*
 * Who may approve what (UI-08, PRD E4.2–E4.5, stories 9–13). Pure, so the rules are unit-tested; the
 * database side is lib/server/approvals.ts. The inbox only explains: these same rules run on the server.
 */

export type ReviewState = "waiting" | "partial" | "expired" | "edited";

export interface ReviewItem {
  detail: RunDetail;
  state: ReviewState;
  canApprove: boolean;
  /** Why this user can't approve (shown next to the disabled button). */
  reason?: string;
}

export const needsReview = (d: RunDetail) => d.approvalsRequired > 0 && (d.status === "pending_approval" || (d.status === "approved" && d.approvalExpired));

export function stateOf(d: RunDetail): ReviewState {
  if (d.status === "approved") return "expired";
  if (d.voidedApprovals > 0) return "edited";
  return d.approvalRecords.length ? "partial" : "waiting";
}

/** Null when `user` may approve this run now; otherwise the reason, in words. */
export function approvalProblem(d: RunDetail, createdById: string, user: SessionUser, now: Date): string | null {
  if (!atLeast(user.role, "approver")) return "Only approvers can approve runs.";
  if (!needsReview(d)) return "This run doesn't need an approval.";
  if (createdById === user.id) return "You created this run, so someone else has to approve it.";
  const mine = d.approvalRecords.find((a) => a.byId === user.id);
  if (mine && mine.expiresAt > now.toISOString()) {
    return d.approvalsRequired === 2 ? "You already approved this version. Prod-like runs need a second, different approver." : "You already approved this version.";
  }
  return null;
}
