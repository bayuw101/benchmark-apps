import { setBaseline } from "@/lib/server/run-actions";
import { loadRun, respond } from "@/lib/runs/respond";
import { withAuth } from "@/lib/server/with-auth";

/** POST /api/runs/[id]/baseline — pin this run as the baseline for its target + scenario (story 36). Engineer and above. */
export const POST = withAuth<{ id: string }>(
  async (_request, { user, params }) => {
    const run = await loadRun(params.id);
    return run instanceof Response ? run : respond(await setBaseline(run, user, new Date()));
  },
  { role: "engineer", forbidden: "Setting a baseline needs the engineer role or higher." },
);
