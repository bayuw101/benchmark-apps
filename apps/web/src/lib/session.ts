import type { Role } from "@btb/contracts";

// Roles from PRD E1.3. Stored in the database, not taken from Entra groups.
export type { Role };

/** The signed-in person. Only people with a role get a session (no role = no access, PRD E1). */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export const ROLE_LABEL: Record<Role, string> = {
  viewer: "Viewer",
  engineer: "Engineer",
  approver: "Approver",
  admin: "Admin",
};

/**
 * ASSUMPTION (open question "role hierarchy"): roles form a ladder, so a higher role can do what a
 * lower one can. The PRD implies it ("set as baseline: engineer and above") but never states it.
 */
const ROLE_RANK: Record<Role, number> = { viewer: 0, engineer: 1, approver: 2, admin: 3 };

export function atLeast(role: Role, minimum: Role) {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}
