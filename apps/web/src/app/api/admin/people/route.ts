import { personInputSchema } from "@btb/contracts/schemas";

import { addPerson } from "@/lib/server/admin";
import { respond } from "@/lib/admin/respond";
import { withAuth } from "@/lib/server/with-auth";

/** POST /api/admin/people — give someone access before their first sign-in. Admin only. */
export const POST = withAuth(async (_request, { user, body }) => respond(addPerson(body, user), true), { role: "admin", schema: personInputSchema });
