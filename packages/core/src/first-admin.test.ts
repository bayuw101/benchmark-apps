import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createDb, type Tx } from "./db";
import { ensureFirstAdmin } from "./first-admin";

/* Runs against the migrated database (vitest.config.ts); every case rolls back, so local data is untouched. */
const url = process.env.DATABASE_URL;

class Rollback extends Error {}

async function inRollback(body: (tx: Tx) => Promise<void>) {
  const { db, pool } = createDb({ connectionString: url });
  try {
    await db.transaction(async (tx) => {
      await body(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  } finally {
    await pool.end();
  }
}

const noAdmins = (tx: Tx) => tx.execute(sql`UPDATE users SET role = 'engineer' WHERE role = 'admin'`);

describe.skipIf(!url)("first admin from the env var (E1.3)", () => {
  it("creates the person only while no admin exists, and never again", () =>
    inRollback(async (tx) => {
      await noAdmins(tx);
      expect(await ensureFirstAdmin(tx, " First.Admin@Example.com ")).toBe("created");
      expect(await ensureFirstAdmin(tx, "first.admin@example.com")).toBe("already_admin");
      expect(await ensureFirstAdmin(tx, "someone.else@example.com")).toBe("skipped_admin_exists");
      const rows = await tx.execute(sql`SELECT name, role FROM users WHERE email = 'first.admin@example.com'`);
      expect(rows.rows[0]).toEqual({ name: "first.admin", role: "admin" });
    }));

  it("promotes an existing person instead of adding a second row", () =>
    inRollback(async (tx) => {
      await noAdmins(tx);
      await tx.execute(sql`INSERT INTO users (email, name, role) VALUES ('promote.me@example.com', 'Promote Me', 'viewer')`);
      expect(await ensureFirstAdmin(tx, "PROMOTE.ME@example.com")).toBe("promoted");
      const rows = await tx.execute(sql`SELECT count(*)::int AS n, max(role::text) AS role FROM users WHERE lower(email) = 'promote.me@example.com'`);
      expect(rows.rows[0]).toEqual({ n: 1, role: "admin" });
    }));

  it("rejects something that isn't an email", async () => {
    await expect(ensureFirstAdmin({} as Tx, "not-an-email")).rejects.toThrow(/not an email/);
  });
});
