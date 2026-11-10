import { artifactKey } from "@btb/core/env";
import { RUNNER_ARTIFACT_MAX_BYTES, RUNNER_ARTIFACTS_PER_RUN, runnerArtifactOf } from "@btb/contracts";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db, schema } from "@/db";
import { putArtifact } from "@/lib/server/artifacts";
import { withRunnerAuth } from "@/lib/server/with-auth";

const { runArtifacts, runs } = schema;

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function bodyMatches(contentType: string, body: Buffer) {
  if (contentType === "image/png") return body.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC);
  try {
    JSON.parse(body.toString("utf8"));
    return true;
  } catch {
    return false;
  }
}

/**
 * POST /api/runner/artifacts?runId=&name= — runner pods upload browser screenshots and errors (E5.7) while
 * their run is live. Same auth as the lease: the run's lease token, no user session.
 */
export const POST = withRunnerAuth(async (request, { runId }) => {
  const name = request.nextUrl.searchParams.get("name") ?? "";
  const kind = runnerArtifactOf(name);
  if (!kind) return fail(400, "file name not allowed");
  const length = Number(request.headers.get("content-length"));
  if (!request.headers.has("content-length") || !Number.isInteger(length)) return fail(411, "content-length required");
  if (length > RUNNER_ARTIFACT_MAX_BYTES) return fail(413, "file too large");

  const [run] = await db.select({ status: runs.status }).from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run || (run.status !== "starting" && run.status !== "running")) return fail(409, "run is not live");

  const body = Buffer.from(await request.arrayBuffer());
  if (body.length > RUNNER_ARTIFACT_MAX_BYTES) return fail(413, "file too large");
  if (!bodyMatches(kind.contentType, body)) return fail(400, `body is not ${kind.contentType}`);

  const stored = await db.select({ name: runArtifacts.name }).from(runArtifacts).where(eq(runArtifacts.runId, runId));
  const fromRunners = stored.filter((a) => runnerArtifactOf(a.name));
  if (!fromRunners.some((a) => a.name === name) && fromRunners.length >= RUNNER_ARTIFACTS_PER_RUN) return fail(429, "artifact limit reached");

  const key = artifactKey(runId, name);
  await putArtifact(key, body, kind.contentType);
  const row = { label: kind.label, contentType: kind.contentType, sizeBytes: body.length };
  await db
    .insert(runArtifacts)
    .values({ runId, name, s3Key: key, ...row })
    .onConflictDoUpdate({ target: [runArtifacts.runId, runArtifacts.name], set: row });
  return NextResponse.json({ ok: true });
}, { runIdIn: "query" });
