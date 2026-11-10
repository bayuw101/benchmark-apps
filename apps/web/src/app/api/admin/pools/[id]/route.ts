import { poolInputSchema, type PoolInput } from "@btb/contracts/schemas";

import { deletePool, upsertPool } from "@/lib/server/admin";
import { respond } from "@/lib/admin/respond";
import { activeProject } from "@/lib/server/projects";
import { withAuth } from "@/lib/server/with-auth";

const project = async () => (await activeProject()).projectId;

/** PUT /api/admin/pools/[target] — set up or edit a target's test-data pool and hooks. Admin only. */
export const PUT = withAuth<{ id: string }, PoolInput>(
  async (_request, { user, params, body }) => respond(upsertPool(await project(), params.id, body, user)),
  { role: "admin", schema: poolInputSchema },
);

/** DELETE /api/admin/pools/[target] — the target runs without managed test data. Admin only. */
export const DELETE = withAuth<{ id: string }>(async (_request, { user, params }) => respond(deletePool(await project(), params.id, user)), { role: "admin" });
