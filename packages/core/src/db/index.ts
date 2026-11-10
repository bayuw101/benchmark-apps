import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import * as schema from "./schema";

/** One pool per process. The web app keeps it on globalThis (hot reload); the worker creates it once. */
export function createDb(config: PoolConfig) {
  const pool = new Pool(config);
  const db = drizzle({ client: pool, schema, casing: "snake_case" });
  return { db, pool };
}

export type Db = ReturnType<typeof createDb>["db"];
/** A transaction handle; anything that takes `Db | Tx` works inside or outside a transaction. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export { schema };
export * from "./schema";

/** Postgres unique violation; drizzle wraps driver errors in `cause`. */
export function isUniqueViolation(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const err = e as { code?: unknown; cause?: unknown };
  return err.code === "23505" || isUniqueViolation(err.cause);
}
