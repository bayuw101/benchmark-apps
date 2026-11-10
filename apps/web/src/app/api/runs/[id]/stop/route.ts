import { stopRun } from "@/lib/server/run-actions";
import { loadRun, respond } from "@/lib/runs/respond";
import { withAuth } from "@/lib/server/with-auth";

/**
 * POST /api/runs/[id]/stop — engineer and above, audit-logged. A queued run leaves the queue (back to approved).
 * A starting or running run gets the emergency stop (PRD E6.2, N5): it goes to "stopping", the worker deletes the
 * TestRun and marks it aborted, and the page follows the live stream.
 */
export const POST = withAuth<{ id: string }>(
  async (_request, { user, params }) => {
    const run = await loadRun(params.id);
    return run instanceof Response ? run : respond(await stopRun(run, user, new Date()));
  },
  { role: "engineer", forbidden: "Only engineers and above can stop runs." },
);
