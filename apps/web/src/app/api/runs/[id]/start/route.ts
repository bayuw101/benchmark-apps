import { startRun } from "@/lib/server/run-actions";
import { loadRun, respond } from "@/lib/runs/respond";
import { withAuth } from "@/lib/server/with-auth";

/** POST /api/runs/[id]/start — re-check approval and policy, preflight, then queue for the worker (PRD stories 7, 12). */
export const POST = withAuth<{ id: string }>(
  async (_request, { user, params }) => {
    const run = await loadRun(params.id);
    return run instanceof Response ? run : respond(await startRun(run, user, new Date()));
  },
  { role: "engineer" },
);
