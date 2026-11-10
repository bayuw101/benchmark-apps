import { writeAudit } from "@btb/core/audit";
import { RUNNER_CALLBACK_MAX_BYTES, RUNNER_CALLBACKS_PER_RUN, type RunnerCallback, type Tone } from "@btb/contracts";
import { runnerCallbackSchema } from "@btb/contracts/schemas";
import { and, count, eq, isNotNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db, schema } from "@/db";
import { withRunnerAuth } from "@/lib/server/with-auth";

const { auditLogs, runs } = schema;
const LIVE = new Set(["starting", "running", "stopping"]);

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

function entry(c: RunnerCallback): { action: string; detail: string; tone: Tone } {
  switch (c.event) {
    case "verified":
      return { action: "Runner verified", detail: `${c.pod}: manifest hash, approvals and allowlist checked before load.`, tone: "info" };
    case "refused":
      return { action: "Runner refused to start", detail: `${c.pod}: ${c.reason ?? "no reason given"}`, tone: "danger" };
    case "stopped":
      return { action: "Runner stopped the load", detail: `${c.pod}: ${c.reason ?? "no reason given"}`, tone: "warning" };
    case "finished": {
      const its = c.iterations === undefined ? "" : ` ${c.iterations} iterations,`;
      const th = c.thresholdsOk === false ? " thresholds crossed." : " thresholds held.";
      return { action: "Runner finished", detail: `${c.pod}:${its}${th}`, tone: c.thresholdsOk === false ? "warning" : "success" };
    }
  }
}

/**
 * POST /api/runner/callback — signed reports from runner pods (E5.4, E6.6): Bearer lease token, and the raw body
 * HMAC'd with that token in x-btb-signature, then parsed with the shared zod schema (400 when it doesn't fit).
 * Stored on the run's timeline (audit_logs, data.callback).
 */
export const POST = withRunnerAuth(
  async (_request, { body: c }) => {
    const [run] = await db.select({ status: runs.status, projectId: runs.projectId }).from(runs).where(eq(runs.id, c.runId)).limit(1);
    if (!run || !LIVE.has(run.status)) return fail(409, "run is not live");

    const [{ n }] = await db
      .select({ n: count() })
      .from(auditLogs)
      .where(and(eq(auditLogs.runId, c.runId), isNotNull(sql`${auditLogs.data}->>'callback'`)));
    if (n >= RUNNER_CALLBACKS_PER_RUN) return fail(429, "callback limit reached");

    const { runId, event, ...rest } = c;
    await writeAudit(db, { actor: null, ...entry(c), projectId: run.projectId, runId, data: { callback: event, ...rest } });
    return NextResponse.json({ ok: true });
  },
  { runIdIn: "body", signed: { maxBytes: RUNNER_CALLBACK_MAX_BYTES }, schema: runnerCallbackSchema },
);
