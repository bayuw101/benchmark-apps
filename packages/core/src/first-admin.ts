import { eq, sql } from "drizzle-orm";

import { writeAudit } from "./audit";
import { users, type DbOrTx } from "./db";

export const FIRST_ADMIN_ENV = "BTB_FIRST_ADMIN_EMAIL";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type FirstAdminResult = "created" | "promoted" | "already_admin" | "skipped_admin_exists";

/**
 * PRD E1.3: the first admin comes from an env var. It only acts while the database has no admin at all, so the
 * variable can't grant admin again later (after that, admins manage roles in Admin and every change is audited).
 * Creates the person (name from the email until their first sign-in) or promotes an existing row.
 */
export async function ensureFirstAdmin(db: DbOrTx, rawEmail: string): Promise<FirstAdminResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new Error(`${FIRST_ADMIN_ENV} is not an email address`);

  return db.transaction(async (tx) => {
    // One bootstrap at a time: two app instances starting together must not both act.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('btb-first-admin'))`);
    const [admin] = await tx.select({ email: users.email }).from(users).where(eq(users.role, "admin")).limit(1);
    if (admin) return admin.email.toLowerCase() === email ? "already_admin" : "skipped_admin_exists";

    const [existing] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
    let result: FirstAdminResult;
    if (existing) {
      await tx.update(users).set({ role: "admin", updatedAt: new Date() }).where(eq(users.id, existing.id));
      result = "promoted";
    } else {
      await tx.insert(users).values({ email, name: email.split("@")[0], role: "admin" });
      result = "created";
    }
    await writeAudit(tx, { actor: null, action: "First admin set", detail: `${email} became admin from ${FIRST_ADMIN_ENV} (no admin existed).` });
    return result;
  });
}
