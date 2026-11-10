import { targetInputSchema } from "@btb/contracts/schemas";

import { upsertTarget } from "@/lib/server/admin";
import { respond } from "@/lib/admin/respond";
import { activeProject } from "@/lib/server/projects";
import { withAuth } from "@/lib/server/with-auth";

/** POST /api/admin/targets — create a target in the active project. Admin only. */
export const POST = withAuth(
  async (_request, { user, body }) => {
    const { projectId } = await activeProject();
    return respond(upsertTarget(projectId, body, user), true);
  },
  { role: "admin", schema: targetInputSchema },
);
