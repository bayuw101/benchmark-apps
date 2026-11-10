import "server-only";
import { NextResponse } from "next/server";

import { getRun } from "@/lib/server/runs";
import type { ActionResult } from "@/lib/server/run-actions";
import type { ApprovalResult } from "@/lib/server/approvals";
import type { RunRecord } from "./detail";

/*
 * Shared by the /api/runs/[id]/* handlers. Session and role are checked by withAuth before any of this.
 */

export const noStore = { "Cache-Control": "no-store" };

/** The run, or a 404 response. */
export async function loadRun(id: string): Promise<RunRecord | NextResponse> {
  return (await getRun(id)) ?? NextResponse.json({ error: "not found" }, { status: 404 });
}

/** `invalid` names the 422 body's error: "policy" for plan violations, "invalid" for anything else. */
export function respond(result: ActionResult | ApprovalResult, invalid: "policy" | "invalid" = "invalid") {
  if (result.ok) return NextResponse.json(result.detail, { headers: noStore });
  if (result.status === 422) return NextResponse.json({ error: invalid, violations: result.violations }, { status: 422 });
  if (result.status === 404) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ error: "conflict", reason: result.reason, ...("preflight" in result && result.preflight ? { preflight: result.preflight } : {}) }, { status: 409 });
}
