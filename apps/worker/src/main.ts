import { LIVE_INTERVAL_SEC, redisKeys, RUNS_QUEUE, WORKER_HEARTBEAT_TTL_SEC, type RunJob } from "@btb/contracts";
import { createDb } from "@btb/core/db";
import { Worker } from "bullmq";
import { Redis } from "ioredis";

import { ArtifactStore } from "./artifacts";
import type { Ctx } from "./context";
import { dispatch } from "./dispatch";
import { loadConfig } from "./env";
import { guardRunning } from "./guards";
import { DockerExecutor, KubernetesExecutor } from "./executors";
import { Kube } from "./kube";
import { sampleLive } from "./live";
import { LIVE_LOCK_KEY, tryWithLock, withLock } from "./lock";
import { errorMessage, log } from "./log";
import { HEALTH_PROBE_EVERY_SEC } from "./plan";
import { Prometheus } from "./prometheus";
import { reconcile, stopRun } from "./reconcile";

/*
 * apps/worker: the execution half of the platform (PRD E3.5, E8). BullMQ jobs from the web app (dispatch,
 * stop) plus two timers: the tick (reconcile, safety guards, and a dispatch sweep that catches lost jobs) and
 * the live loop. Postgres is the source of truth; jobs and ticks run under one advisory lock. The live loop
 * has its own lock and a fail-fast Redis client, so Prometheus or Redis trouble can't delay a stop.
 */

/** Queued runs are picked up even if their dispatch job was lost: every Nth tick (15 s). */
const DISPATCH_SWEEP_TICKS = 3;
const HEALTH_PROBE_TICKS = HEALTH_PROBE_EVERY_SEC / LIVE_INTERVAL_SEC;

const cfg = loadConfig();
const { db, pool } = createDb({ connectionString: cfg.databaseUrl, max: 5 });
// Live samples only: fail fast while Redis is down (no offline queue), so a sample is skipped, never awaited forever.
const redis = new Redis(cfg.redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
redis.on("error", (e) => log.warn("redis error", { reason: errorMessage(e) }));
const kube = new Kube(cfg.kubeconfig);
const ctx: Ctx = {
  cfg,
  db,
  pool,
  redis,
  kube,
  executors: { kubernetes: new KubernetesExecutor(kube, cfg.maxParallelism), docker: new DockerExecutor(cfg.docker.network) },
  prom: new Prometheus(cfg.prometheusUrl),
  artifacts: new ArtifactStore(),
};

const worker = new Worker<RunJob["data"], void, RunJob["name"]>(
  RUNS_QUEUE,
  async (job) => {
    await withLock(pool, async () => {
      if (job.name === "stop" && "runId" in job.data) await stopRun(ctx, job.data.runId);
      await dispatch(ctx);
    });
  },
  { connection: new Redis(cfg.redisUrl, { maxRetriesPerRequest: null }), concurrency: 1 },
);
worker.on("failed", (job, e) => log.error("job failed", { job: job?.name, data: job?.data, reason: errorMessage(e) }));
worker.on("error", (e) => log.error("queue error", { reason: errorMessage(e) }));

let shuttingDown = false;
let tickBusy = false;
let liveBusy = false;
let ticks = 0;

/** Reconcile, safety guards, dispatch sweep. Skipped while a job or another replica holds the lock; never overlaps itself. */
async function tick() {
  if (tickBusy || shuttingDown) return;
  tickBusy = true;
  const n = ticks++;
  // Lets the lease endpoint tell runners whether anyone is still minding their run.
  redis.set(redisKeys.workerHeartbeat, "1", "EX", WORKER_HEARTBEAT_TTL_SEC).catch((e) => log.warn("heartbeat failed", { reason: errorMessage(e) }));
  try {
    await tryWithLock(pool, async () => {
      const ended = await reconcile(ctx);
      const aborted = await guardRunning(ctx, n % HEALTH_PROBE_TICKS === 0);
      if (ended || aborted || n % DISPATCH_SWEEP_TICKS === 0) await dispatch(ctx);
    });
  } catch (e) {
    log.error("tick failed", { reason: errorMessage(e) });
  } finally {
    tickBusy = false;
  }
}
/** One sample per running run, by one replica (N1). Never holds the state lock, so it can't hold up a stop. */
async function liveTick() {
  if (liveBusy || shuttingDown) return;
  liveBusy = true;
  try {
    await tryWithLock(pool, () => sampleLive(ctx), LIVE_LOCK_KEY);
  } catch (e) {
    log.error("live loop failed", { reason: errorMessage(e) });
  } finally {
    liveBusy = false;
  }
}

const timers = [setInterval(tick, LIVE_INTERVAL_SEC * 1000), setInterval(liveTick, LIVE_INTERVAL_SEC * 1000)];
void tick();
void liveTick();

log.info("worker started", {
  queue: RUNS_QUEUE,
  prometheus: cfg.prometheusUrl,
  kubeconfig: cfg.kubeconfig,
  maxParallelism: cfg.maxParallelism,
  perNamespace: cfg.perNamespace,
  dockerEnvironments: cfg.docker.environments,
});
if (!(await ctx.prom.ready())) log.warn("Prometheus is not reachable; runs will fail the monitoring preflight", { prometheus: cfg.prometheusUrl });

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("shutting down", { signal });
  timers.forEach(clearInterval);
  await worker.close();
  // Waits for a tick or a live sample still holding its lock.
  await withLock(pool, async () => {});
  await withLock(pool, async () => {}, LIVE_LOCK_KEY);
  redis.disconnect();
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
