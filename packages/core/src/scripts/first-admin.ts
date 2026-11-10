/*
 * Seed the first admin (PRD E1.3):  BTB_FIRST_ADMIN_EMAIL=you@example.com pnpm db:first-admin
 * Run after db:migrate on a new environment. A no-op once any admin exists.
 */
import { databaseUrl } from "../env";
import { createDb } from "../db";
import { ensureFirstAdmin, FIRST_ADMIN_ENV } from "../first-admin";

const email = process.env[FIRST_ADMIN_ENV];
if (!email) {
  console.error(`${FIRST_ADMIN_ENV} is not set.`);
  process.exit(1);
}

const { db, pool } = createDb({ connectionString: databaseUrl() });
try {
  const result = await ensureFirstAdmin(db, email);
  console.log(
    {
      created: `Created ${email.trim()} as admin.`,
      promoted: `${email.trim()} is now admin.`,
      already_admin: `${email.trim()} is already the admin; nothing changed.`,
      skipped_admin_exists: "An admin already exists; nothing changed. Change roles in Admin.",
    }[result],
  );
} finally {
  await pool.end();
}
