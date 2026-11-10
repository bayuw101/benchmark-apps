import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";

import { getUser, toSessionUser } from "@/lib/server/users";
import type { SessionUser } from "@/lib/session";
import { mockAuthEnabled } from "./config";
import { SESSION_COOKIE } from "./constants";
import { verifySession } from "./session-cookie";

/** The current user, or null. The cookie is untrusted: it counts only if our signature checks out and it names a user with a role. Once per request. */
export const getSession = cache(async (): Promise<SessionUser | null> => {
  if (!mockAuthEnabled) return null; // Auth.js `auth()` replaces this when Entra ID lands.
  const id = verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  return id ? toSessionUser(await getUser(id)) : null;
});
