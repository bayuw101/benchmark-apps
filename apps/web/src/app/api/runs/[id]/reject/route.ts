import { rejectInputSchema, type RejectInput } from "@btb/contracts/schemas";

import { rejectRun } from "@/lib/server/approvals";
import { loadRun, respond } from "@/lib/runs/respond";
import { withAuth } from "@/lib/server/with-auth";

/** POST /api/runs/[id]/reject — `{ note }` is required: the engineer needs to know why. */
export const POST = withAuth<{ id: string }, RejectInput>(
  async (_request, { user, params, body }) => {
    const run = await loadRun(params.id);
    if (run instanceof Response) return run;
    return respond(await rejectRun(run, user, body.note, new Date()));
  },
  { role: "approver", forbidden: "Only approvers can reject runs.", schema: rejectInputSchema },
);
