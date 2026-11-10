import type { Pool } from "pg";

/**
 * Every state change the worker makes (dispatch, reconcile, stop) runs under one Postgres advisory lock, so a
 * second worker replica or an overlapping tick can't start the same run twice. Live sampling only writes Redis
 * and takes its own key, so a slow Prometheus or a Redis outage never holds up a stop.
 */
export const LOCK_KEY = 0x6274_6201; // "btb" + 1
export const LIVE_LOCK_KEY = 0x6274_6202;

/** Waits for the lock. */
export async function withLock<T>(pool: Pool, fn: () => Promise<T>, key = LOCK_KEY): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [key]);
    try {
      return await fn();
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [key]);
    }
  } finally {
    client.release();
  }
}

/** Skips (returns undefined) when someone else holds the lock; for periodic ticks. */
export async function tryWithLock<T>(pool: Pool, fn: () => Promise<T>, key = LOCK_KEY): Promise<T | undefined> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [key]);
    if (!rows[0]?.ok) return undefined;
    try {
      return await fn();
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [key]);
    }
  } finally {
    client.release();
  }
}
