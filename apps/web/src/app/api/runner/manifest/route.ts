import { approvalsSatisfied } from "@btb/core/approvals";
import type { RunManifest, RunnerManifestReply } from "@btb/contracts";
import { runManifestSchema } from "@btb/contracts/schemas";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db, schema } from "@/db";
import { withRunnerAuth } from "@/lib/server/with-auth";

const { approvals, runs, targets } = schema;

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

/**
 * GET /api/runner/manifest?runId= — the runner's self-check before load (E5.3). Returns the stored manifest, the
 * approved hash and the target allowlist as they are now; the runner recomputes the hash itself.
 */
export const GET = withRunnerAuth(async (_request, { runId }) => {
  const [row] = await db
    .select({ run: runs, target: { hosts: targets.hosts, paths: targets.paths, methods: targets.methods } })
    .from(runs)
    .innerJoin(targets, eq(runs.targetId, targets.id))
    .where(eq(runs.id, runId))
    .limit(1);
  if (!row || (row.run.status !== "starting" && row.run.status !== "running")) return fail(409, "run is not live");
  const { run, target } = row;

  const rows = await db
    .select({ userId: approvals.userId, manifestHash: approvals.manifestHash, decision: approvals.decision, expiresAt: approvals.expiresAt })
    .from(approvals)
    .where(eq(approvals.runId, runId));
  // Parsed, not cast: a stored manifest outside the contract is refused rather than handed to the runner.
  const parsed = runManifestSchema.safeParse(run.manifest);
  if (!parsed.success) return fail(500, "stored manifest doesn't match the contract");
  const manifest = parsed.data;
  const environment = run.environment as RunManifest["environment"];
  // Same rule as the worker's Start check: expiry counted when Start was pressed, not now.
  const approved = approvalsSatisfied({ environment, preset: run.preset, manifestHash: run.manifestHash, createdById: run.createdBy }, rows);

  const reply: RunnerManifestReply = { manifest, manifestHash: run.manifestHash, approved, allowlist: target };
  return NextResponse.json(reply);
}, { runIdIn: "query" });
