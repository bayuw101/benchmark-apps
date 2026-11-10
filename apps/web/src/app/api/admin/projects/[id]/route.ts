import { projectInputSchema, type ProjectInput } from "@btb/contracts/schemas";

import { deleteProject, updateProject } from "@/lib/server/admin";
import { respond } from "@/lib/admin/respond";
import { withAuth } from "@/lib/server/with-auth";

/** PATCH /api/admin/projects/[id] — rename or describe. Admin only. */
export const PATCH = withAuth<{ id: string }, ProjectInput>(
  async (_request, { user, params, body }) => respond(updateProject(params.id, body, user)),
  { role: "admin", schema: projectInputSchema },
);

/** DELETE /api/admin/projects/[id] — only an empty project. Admin only. */
export const DELETE = withAuth<{ id: string }>(async (_request, { user, params }) => respond(deleteProject(params.id, user)), { role: "admin" });
