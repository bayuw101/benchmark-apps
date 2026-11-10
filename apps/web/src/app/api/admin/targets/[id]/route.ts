import { targetInputSchema, type TargetInput } from "@btb/contracts/schemas";

import { deleteTarget, upsertTarget } from "@/lib/server/admin";
import { respond } from "@/lib/admin/respond";
import { activeProject } from "@/lib/server/projects";
import { withAuth } from "@/lib/server/with-auth";

const project = async () => (await activeProject()).projectId;

/** PATCH /api/admin/targets/[id] — edit allowlist, peak, health and integrity endpoints (not the id). Admin only. */
export const PATCH = withAuth<{ id: string }, TargetInput>(
  async (_request, { user, params, body }) => respond(upsertTarget(await project(), body, user, params.id)),
  { role: "admin", schema: targetInputSchema },
);

/** DELETE /api/admin/targets/[id] — only a target no run has used. Admin only. */
export const DELETE = withAuth<{ id: string }>(async (_request, { user, params }) => respond(deleteTarget(await project(), params.id, user)), { role: "admin" });
