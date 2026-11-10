import "server-only";

import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { RUNS_QUEUE, type RunJob } from "@btb/contracts";
import { redisUrl } from "@btb/core/env";

/*
 * Redis: read-only live samples for the SSE route, and the BullMQ producer for the worker's queue.
 * Kept on globalThis like the database pool, so hot reloads don't leak connections.
 */

// Read on first use, not at import: `next build` imports this module without a REDIS_URL. In production a missing
// REDIS_URL throws (redisUrl) instead of quietly connecting to whatever listens on localhost.
const g = globalThis as unknown as { __btbRedis?: Redis; __btbQueue?: Queue };

export function redis(): Redis {
  // Fail fast: a page waiting on Redis is worse than one that shows live numbers as missing.
  return (g.__btbRedis ??= new Redis(redisUrl(), { maxRetriesPerRequest: 1 }));
}

function runsQueue(): Queue {
  // Producers may fail fast too (only BullMQ workers need maxRetriesPerRequest: null).
  return (g.__btbQueue ??= new Queue(RUNS_QUEUE, { connection: new Redis(redisUrl(), { maxRetriesPerRequest: 1 }) }));
}

/**
 * Asks the worker to act. Called after the transaction commits; if Redis is down the run is still saved
 * and the worker's periodic sweep picks it up, so a failed enqueue is logged, not shown as an error.
 */
export async function enqueue(job: RunJob) {
  try {
    await runsQueue().add(job.name, job.data, { removeOnComplete: 1000, removeOnFail: 1000 });
  } catch (error) {
    console.error(`enqueue ${job.name} failed`, error);
  }
}
