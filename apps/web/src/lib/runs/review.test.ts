import { describe, expect, it } from "vitest";

import type { SessionUser } from "@/lib/session";
import { buildRunDetail, type ApprovalRow } from "./detail";
import { approvalProblem, stateOf } from "./review";
import { completedRun } from "./test-catalog";

/*
 * The approval rules a run detail is built from (PRD E4.2–E4.5): hash binding, expiry, distinct approvers,
 * and who may approve. The database side commits what these decide.
 */

const now = new Date("2026-11-08T12:00:00Z");
const HOUR = 3_600_000;
const user = (id: string, role: SessionUser["role"] = "approver"): SessionUser => ({ id, name: id, email: `${id}@example.com`, role });
const approval = (userId: string | null, over: Partial<ApprovalRow> = {}): ApprovalRow => ({
  userId,
  userName: userId,
  rule: userId ? null : "Peak on staging within ceilings",
  manifestHash: "a".repeat(64),
  decision: "approved",
  note: null,
  createdAt: new Date(now.getTime() - HOUR),
  expiresAt: new Date(now.getTime() + 23 * HOUR),
  ...over,
});

/** A run waiting for approval: prod-like peak (2 approvers) or staging spike (1). Created by "creator". */
function pending(env: "prod-like" | "staging", approvals: ApprovalRow[], status: "pending_approval" | "approved" = "pending_approval") {
  const inputs = env === "prod-like"
    ? completedRun({ scenario: "Checkout", version: 4, environment: "prod-like", target: "tickets-prodlike", preset: "peak" })
    : completedRun({ scenario: "Checkout", version: 4, environment: "staging", target: "tickets-staging", preset: "spike" });
  inputs.run = { ...inputs.run, status, startedAt: undefined, endedAt: undefined, verdict: undefined, ref: { ...inputs.run.ref, createdById: "creator" } };
  return buildRunDetail({ ...inputs, summary: null, approvals }, now);
}

describe("who may approve", () => {
  it("never the person who created the run", () => {
    expect(approvalProblem(pending("staging", []), "creator", user("creator"), now)).toMatch(/You created this run/);
  });

  it("only approvers and above", () => {
    expect(approvalProblem(pending("staging", []), "creator", user("e", "engineer"), now)).toMatch(/Only approvers/);
    expect(approvalProblem(pending("staging", []), "creator", user("a", "admin"), now)).toBeNull();
  });

  it("prod-like needs a second, different approver", () => {
    const d = pending("prod-like", [approval("u1")]);
    expect(d.approvalsRequired).toBe(2);
    expect(stateOf(d)).toBe("partial");
    expect(approvalProblem(d, "creator", user("u1"), now)).toMatch(/second, different approver/);
    expect(approvalProblem(d, "creator", user("u2"), now)).toBeNull();
  });
});

describe("approval records", () => {
  it("an edit (new hash) voids earlier approvals", () => {
    const d = pending("staging", [approval("u1", { manifestHash: "b".repeat(64) })]);
    expect(d.approvalRecords).toEqual([]);
    expect(d.voidedApprovals).toBe(1);
    expect(stateOf(d)).toBe("edited");
    expect(approvalProblem(d, "creator", user("u1"), now)).toBeNull();
  });

  it("an approved run whose approval expired goes back to the inbox and can't start", () => {
    const old = approval("u1", { createdAt: new Date(now.getTime() - 25 * HOUR), expiresAt: new Date(now.getTime() - HOUR) });
    const d = pending("staging", [old], "approved");
    expect(d.approvalExpired).toBe(true);
    expect(d.start).toEqual({ ok: false, reason: expect.stringMatching(/expired/) });
    expect(stateOf(d)).toBe("expired");
    expect(approvalProblem(d, "creator", user("u1"), now)).toBeNull();
  });

  it("an expired policy approval doesn't block Start (Start renews it)", () => {
    const inputs = completedRun({ scenario: "Checkout", version: 4, environment: "staging", target: "tickets-staging", preset: "peak" });
    inputs.run = { ...inputs.run, status: "approved", startedAt: undefined, endedAt: undefined, verdict: undefined };
    const old = approval(null, { createdAt: new Date(now.getTime() - 25 * HOUR), expiresAt: new Date(now.getTime() - HOUR) });
    const d = buildRunDetail({ ...inputs, summary: null, approvals: [old] }, now);
    expect(d.approvalsRequired).toBe(0);
    expect(d.approvalExpired).toBe(false);
    expect(d.start).toEqual({ ok: true });
  });
});
