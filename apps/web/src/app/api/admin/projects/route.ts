import { projectInputSchema } from "@btb/contracts/schemas";

import { createProject } from "@/lib/server/admin";
import { respond } from "@/lib/admin/respond";
import { withAuth } from "@/lib/server/with-auth";

/** POST /api/admin/projects — create a project. Admin only. */
export const POST = withAuth(async (_request, { user, body }) => respond(createProject(body, user), true), { role: "admin", schema: projectInputSchema });
