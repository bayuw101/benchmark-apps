import { ceilingInputSchema, type CeilingInput } from "@btb/contracts/schemas";

import { updateCeiling } from "@/lib/server/admin";
import { respond } from "@/lib/admin/respond";
import { withAuth } from "@/lib/server/with-auth";

/** PATCH /api/admin/environments/[id] — change the environment's ceilings. Admin only. */
export const PATCH = withAuth<{ id: string }, CeilingInput>(
  async (_request, { user, params, body }) => respond(updateCeiling(params.id, body, user)),
  { role: "admin", schema: ceilingInputSchema },
);
