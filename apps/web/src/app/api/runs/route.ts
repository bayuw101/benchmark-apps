import { NextResponse } from "next/server";

import { createRun } from "@/lib/server/run-actions";
import { runPlanInputSchema } from "@btb/contracts/schemas";
import { respond } from "@/lib/runs/respond";
import type { RunFilters } from "@/lib/runs/types";
import { activeProject } from "@/lib/server/projects";
import { queryRuns } from "@/lib/server/runs";
import { withAuth } from "@/lib/server/with-auth";

const PAGE_SIZE = 25;
const text = (v: string | null) => (v && v.length <= 100 ? v : undefined);

/** GET /api/runs — the active project's in-flight runs plus a filtered page of history. */
export const GET = withAuth(async (request) => {
  const sp = request.nextUrl.searchParams;
  // Development-only switches to see the page's states: error, forbidden, empty, idle, slow.
  const simulate = process.env.NODE_ENV !== "production" ? sp.get("simulate") : null;
  if (simulate === "error") return NextResponse.json({ error: "boom" }, { status: 500 });
  if (simulate === "forbidden") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (simulate === "slow") await new Promise((r) => setTimeout(r, 2500));

  const result = sp.get("result");
  const cursor = sp.get("cursor");
  if (cursor !== null && !/^\d{1,6}$/.test(cursor)) return NextResponse.json({ error: "bad cursor" }, { status: 400 });
  const filters: RunFilters = {
    target: text(sp.get("target")),
    scenario: text(sp.get("scenario")),
    release: text(sp.get("release")),
    result: result === "pass" || result === "fail" ? result : undefined,
    q: text(sp.get("q"))?.trim() || undefined,
  };

  const { projectId } = await activeProject();
  const page =
    simulate === "empty"
      ? { active: [], items: [], nextCursor: null, total: 0, facets: { targets: [], scenarios: [], releases: [] } }
      : await queryRuns(projectId, filters, cursor, PAGE_SIZE, new Date());
  // `?simulate=idle`: history as usual, nothing in flight (the band's empty state).
  if (simulate === "idle") page.active = [];
  return NextResponse.json({ projectId, ...page }, { headers: { "Cache-Control": "no-store" } });
}, { role: "viewer" });

/**
 * POST /api/runs — create a run (PRD story 1, E3.1–E3.3). Engineer and above.
 * 400 when the body doesn't fit the shared zod schema; 422 lists every policy violation with the form field it
 * belongs to. 201 returns the new run.
 */
export const POST = withAuth(async (request, { user, body: input }) => {
  if (process.env.NODE_ENV !== "production" && request.nextUrl.searchParams.get("simulate") === "error") {
    return NextResponse.json({ error: "boom" }, { status: 500 });
  }

  const { projectId } = await activeProject();
  if (!projectId) return NextResponse.json({ error: "conflict", reason: "There is no project yet." }, { status: 409 });
  const result = await createRun(projectId, input, user, new Date());
  return result.ok ? NextResponse.json(result.detail, { status: 201 }) : respond(result, "policy");
}, { role: "engineer", schema: runPlanInputSchema });
