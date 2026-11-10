import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db, schema } from "@/db";
import { loadRun } from "@/lib/runs/respond";
import { getArtifact, presignedArtifactUrl } from "@/lib/server/artifacts";
import { withAuth } from "@/lib/server/with-auth";

const { runArtifacts } = schema;

/**
 * GET /api/runs/[id]/artifacts/[name] — a short-lived presigned download URL for one artifact (E5.7).
 * JSON rather than a redirect so the browser never fetches the bucket cross-origin (no bucket CORS needed).
 *
 * `?view=1` streams the file itself, inline, for the in-page viewer. `CSP: sandbox` means an HTML or SVG artifact
 * can never run script on this origin, even when opened directly.
 */
export const GET = withAuth<{ id: string; name: string }>(async (request, { params }) => {
  const { id, name } = params;
  const run = await loadRun(id);
  if (run instanceof Response) return run;
  const [artifact] = await db
    .select({ s3Key: runArtifacts.s3Key, contentType: runArtifacts.contentType })
    .from(runArtifacts)
    .where(and(eq(runArtifacts.runId, run.id), eq(runArtifacts.name, name)))
    .limit(1);
  if (!artifact) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (new URL(request.url).searchParams.has("view")) {
    const body = await getArtifact(artifact.s3Key);
    if (!body) return NextResponse.json({ error: "not found" }, { status: 404 });
    return new Response(body, {
      headers: {
        "Content-Type": artifact.contentType,
        "Content-Disposition": "inline",
        "Content-Security-Policy": "sandbox",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=300",
      },
    });
  }
  return NextResponse.json({ url: await presignedArtifactUrl(artifact.s3Key, name) });
}, { role: "viewer" });
