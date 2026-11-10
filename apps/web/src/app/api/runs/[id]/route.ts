import { NextResponse } from "next/server";

import { editRun } from "@/lib/server/run-actions";
import { runPlanInputSchema, type RunPlanInput } from "@btb/contracts/schemas";
import { loadRun, noStore, respond } from "@/lib/runs/respond";
import { loadRunDetail } from "@/lib/server/runs";
import { withAuth } from "@/lib/server/with-auth";

/** GET /api/runs/[id] — Run detail (UI-05). Dev: `?simulate=error|forbidden`. */
export const GET = withAuth<{ id: string }>(
  async (request, { params }) => {
    const simulate = process.env.NODE_ENV !== "production" ? request.nextUrl.searchParams.get("simulate") : null;
    const run = await loadRun(params.id);
    if (run instanceof Response) return run;
    if (simulate === "error") return NextResponse.json({ error: "boom" }, { status: 500 });
    if (simulate === "forbidden") return NextResponse.json({ error: "forbidden" }, { status: 403 });
    return NextResponse.json(await loadRunDetail(run, new Date()), { headers: noStore });
  },
  { role: "viewer" },
);

/** PATCH /api/runs/[id] — Edit before start: new hash, earlier approvals void. Engineer and above. */
export const PATCH = withAuth<{ id: string }, RunPlanInput>(
  async (_request, { user, params, body: input }) => {
    const run = await loadRun(params.id);
    if (run instanceof Response) return run;
    return respond(await editRun(run, input, user, new Date()), "policy");
  },
  { role: "engineer", schema: runPlanInputSchema },
);
