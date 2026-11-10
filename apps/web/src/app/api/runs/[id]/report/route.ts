import { readFile } from "node:fs/promises";
import path from "node:path";

import { renderReport } from "@/lib/runs/report";
import { getRun, loadRunDetail, readSamples } from "@/lib/server/runs";
import { withAuth } from "@/lib/server/with-auth";

let logo: string | null | undefined;
/** The Arbiter mark, inlined so the report needs no network. */
async function logoDataUri() {
  if (logo !== undefined) return logo;
  try {
    logo = `data:image/png;base64,${(await readFile(path.join(process.cwd(), "public", "arbiter-mark-light-bg.png"))).toString("base64")}`;
  } catch {
    logo = null;
  }
  return logo;
}

/**
 * GET /api/runs/[id]/report — the self-contained HTML report (PRD E9.6, story 38). `?download=1` saves it as a file.
 * Rendered on request from the stored summary and the live samples (kept 30 days in Redis).
 */
export const GET = withAuth<{ id: string }>(async (request, { params }) => {
  const now = new Date();
  const run = await getRun(params.id);
  if (!run) return new Response("This run doesn't exist.", { status: 404 });
  const d = await loadRunDetail(run, now);
  if (!d.results || !run.startedAt) return new Response("The report is ready once the run has ended with results.", { status: 409 });

  const samples = await readSamples(run.id).catch(() => []);
  const html = renderReport(d, samples, await logoDataUri(), now);
  const headers: Record<string, string> = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" };
  if (request.nextUrl.searchParams.get("download")) headers["Content-Disposition"] = `attachment; filename="${run.id}-report.html"`;
  return new Response(html, { headers });
}, { role: "viewer" });
