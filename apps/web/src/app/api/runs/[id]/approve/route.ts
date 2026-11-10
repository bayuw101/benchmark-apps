import { approveRun } from "@/lib/server/approvals";
import { loadRun, respond } from "@/lib/runs/respond";
import { withAuth } from "@/lib/server/with-auth";

/** POST /api/runs/[id]/approve — approve the current hash (PRD stories 9–12). Rules live in approveRun. */
export const POST = withAuth<{ id: string }>(
  async (_request, { user, params }) => {
    const run = await loadRun(params.id);
    return run instanceof Response ? run : respond(await approveRun(run, user, new Date()));
  },
  { role: "approver", forbidden: "Only approvers can approve runs." },
);
