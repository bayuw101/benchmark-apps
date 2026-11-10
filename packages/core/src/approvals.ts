import type { Environment, Preset } from "@btb/contracts";

import { approversFor } from "./policy";

/*
 * Which approvals count (E4.2–E4.5). Pure, so the web app (Start, inbox, badge) and the worker (before it
 * creates the TestRun) apply the same rule.
 */

/** Approvals are valid for 24 h (N4, proposed default). */
export const APPROVAL_VALIDITY_MS = 24 * 3_600_000;

export interface ApprovalFacts {
  /** Null = policy (auto-approval). */
  userId: string | null;
  manifestHash: string;
  decision: "approved" | "rejected";
  expiresAt: Date | null;
}

/** Approvals given for this hash. Expired ones included: they still show who approved. */
export function forHash<T extends ApprovalFacts>(rows: T[], manifestHash: string): T[] {
  return rows.filter((a) => a.decision === "approved" && a.manifestHash === manifestHash);
}

/** Approvals that count now: for this hash and not expired. */
export function validApprovals<T extends ApprovalFacts>(rows: T[], manifestHash: string, now: Date): T[] {
  return forHash(rows, manifestHash).filter((a) => !!a.expiresAt && a.expiresAt > now);
}

/**
 * Whether a run's approvals let it run: enough distinct people for its hash (never the creator), or a policy
 * row when it needs nobody. `now` = also require them unexpired (Start); omit it to ignore expiry (the worker,
 * for a run that was approved when it was queued).
 */
export function approvalsSatisfied(
  run: { environment: Environment; preset: Preset; manifestHash: string; createdById: string },
  rows: ApprovalFacts[],
  now?: Date,
): boolean {
  const counted = now ? validApprovals(rows, run.manifestHash, now) : forHash(rows, run.manifestHash);
  const required = approversFor(run.environment, run.preset);
  if (required === 0) return counted.length > 0;
  const people = new Set(counted.flatMap((a) => (a.userId && a.userId !== run.createdById ? [a.userId] : [])));
  return people.size >= required;
}
