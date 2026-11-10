import "server-only";

import { asc, eq, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/session";

type UserRow = typeof schema.users.$inferSelect;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getUser(id: string): Promise<UserRow | undefined> {
  if (!UUID_RE.test(id)) return undefined;
  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
  return row;
}

export async function findUserByEmail(email: string): Promise<UserRow | undefined> {
  const [row] = await db
    .select()
    .from(schema.users)
    .where(eq(sql`lower(${schema.users.email})`, email.trim().toLowerCase()))
    .limit(1);
  return row;
}

export async function listPeople(): Promise<UserRow[]> {
  return db.select().from(schema.users).orderBy(asc(schema.users.createdAt), asc(schema.users.name));
}

/** Only people with a role get a session (no role = no access, PRD E1). */
export function toSessionUser(row: UserRow | undefined): SessionUser | null {
  if (!row?.role) return null;
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}
