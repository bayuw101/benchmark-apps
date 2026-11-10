import "server-only";

import { createDb, schema, type Db } from "@btb/core/db";
import { DEV_DATABASE_URL } from "@btb/core/env";

/*
 * The database client. One pool per process; in development the module is re-evaluated on every
 * hot reload, so the client is kept on globalThis or connections pile up until Postgres says no.
 * Creating the pool doesn't connect, so `next build` works without a database; production must set DATABASE_URL.
 */
const g = globalThis as unknown as { __btbDb?: Db };
const connectionString = process.env.DATABASE_URL ?? (process.env.NODE_ENV === "production" ? undefined : DEV_DATABASE_URL);
export const db: Db = (g.__btbDb ??= createDb({ connectionString, max: 10 }).db);
export type { Db };
export { schema };

