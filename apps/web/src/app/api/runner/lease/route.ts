import { redisKeys, type LeaseReply } from "@btb/contracts";
import { leaseRequestSchema } from "@btb/contracts/schemas";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db, schema } from "@/db";
import { redis } from "@/lib/server/redis";
import { withRunnerAuth } from "@/lib/server/with-auth";

const { runs } = schema;

const reply = (r: LeaseReply) => NextResponse.json(r);

/**
 * POST /api/runner/lease — runner pods check in here (E6.1). No user session: the caller proves itself with the
 * run's lease token. Errors answer non-200, which the runner counts as a missed check-in (it aborts after the grace).
 */
export const POST = withRunnerAuth(async (_request, { runId }) => {
  const [run] = await db.select({ status: runs.status }).from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) return reply({ action: "stop", reason: "unknown run" });
  if (run.status !== "starting" && run.status !== "running") return reply({ action: "stop", reason: `run is ${run.status}` });
  if (!(await redis().exists(redisKeys.workerHeartbeat))) return reply({ action: "stop", reason: "no worker is watching the run" });
  return reply({ action: "continue" });
}, { runIdIn: "body", schema: leaseRequestSchema });
