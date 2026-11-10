import { redisKeys, SAMPLES_TTL_SEC, type LiveSample } from "@btb/contracts";
import { runs } from "@btb/core/db";
import { eq } from "drizzle-orm";

import type { Ctx } from "./context";
import { errorMessage, log } from "./log";
import { liveQueries } from "./plan";

/*
 * Live loop (E8.2): one sample per running run per tick, Prometheus -> Redis. SSE handlers only read the
 * list, so the cost doesn't grow with viewers (N1).
 */
export async function sampleLive(ctx: Ctx) {
  const running = await ctx.db.select({ id: runs.id, startedAt: runs.startedAt, network: runs.network }).from(runs).where(eq(runs.status, "running"));
  for (const r of running) {
    try {
      const now = new Date();
      const v = await ctx.prom.scalars(liveQueries(r.id, r.network !== null), now);
      const rps = v.rps ?? 0;
      const sample: LiveSample = {
        at: now.toISOString(),
        elapsedSec: r.startedAt ? Math.max(0, Math.round((now.getTime() - r.startedAt.getTime()) / 1000)) : 0,
        vus: Math.round(v.vus ?? 0),
        rps: Math.round(rps * 10) / 10,
        p95Ms: Math.round(v.p95 ?? 0),
        p99Ms: Math.round(v.p99 ?? 0),
        errorRatePct: rps > 0 ? Math.round(((v.failedRps ?? 0) / rps) * 100_000) / 1000 : 0,
      };
      const key = redisKeys.samples(r.id);
      await ctx.redis.multi().rpush(key, JSON.stringify(sample)).expire(key, SAMPLES_TTL_SEC).exec();
    } catch (e) {
      log.warn("live sample failed", { runId: r.id, reason: errorMessage(e) });
    }
  }
}
