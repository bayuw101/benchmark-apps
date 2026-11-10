import { roleChangeSchema, type RoleChange } from "@btb/contracts/schemas";

import { changeRole } from "@/lib/server/admin";
import { respond } from "@/lib/admin/respond";
import { withAuth } from "@/lib/server/with-auth";

/** PATCH /api/admin/people/[id] — `{ role }`, or `{ role: "none" }` to remove access. Admin only. */
export const PATCH = withAuth<{ id: string }, RoleChange>(
  async (_request, { user, params, body }) => respond(changeRole(params.id, body.role === "none" ? null : body.role, user)),
  { role: "admin", schema: roleChangeSchema },
);
