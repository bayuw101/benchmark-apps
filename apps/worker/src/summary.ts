import type { LoadModel } from "@btb/contracts";

import { browserQueries, browserSteps, errorRate, gapSeconds, journeyQueries, journeySummary, saturationNumbers, saturationQueries, summaryQueries, type SaturationNumbers, type SummaryNumbers, type Vital } from "./plan";
import type { Prometheus } from "./prometheus";

/** startedAt is when the worker saw the TestRun start (up to one tick late); look this much further back. */
const LEAD_SEC = 30;

/**
 * End-of-run numbers (E9.1) from Prometheus. Null when the run sent no requests at all. `evalAt` (default
 * `endedAt`) is later when the runners' last push can land after the end (emergency stop).
 */
export async function summarize(prom: Prometheus, runId: string, startedAt: Date, endedAt: Date, model: LoadModel, browser: boolean, evalAt = endedAt): Promise<SummaryNumbers | null> {
  const achievedDurationSec = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));
  const windowSec = achievedDurationSec + LEAD_SEC + Math.max(0, (evalAt.getTime() - endedAt.getTime()) / 1000);
  const v = await prom.scalars(summaryQueries(runId, windowSec, model, browser), evalAt);
  if (!v.requests) return null;
  const round = (n: number | null) => Math.round(n ?? 0);
  return {
    p50Ms: round(v.p50),
    p95Ms: round(v.p95),
    p99Ms: round(v.p99),
    errorRatePct: errorRate(v.failed ?? 0, v.requests),
    peakRps: round(v.peakRps),
    maxVus: round(v.maxVus),
    achievedLoad: round(v.peakLoad),
    achievedDurationSec,
    gapSec: gapSeconds(achievedDurationSec, v.pushes ?? 0),
    browser: browser ? await vitals(prom, runId, windowSec, evalAt) : null,
    journey: await journey(prom, runId, windowSec, evalAt),
  };
}

/** Runner CPU and dropped iterations over the run (E9.2). `namespace` is null for Docker runners. */
export async function saturation(prom: Prometheus, runId: string, startedAt: Date, evalAt: Date, namespace: string | null, browser: boolean): Promise<SaturationNumbers> {
  const windowSec = Math.max(0, (evalAt.getTime() - startedAt.getTime()) / 1000) + LEAD_SEC;
  return saturationNumbers(await prom.scalars(saturationQueries(runId, windowSec, namespace, browser), evalAt));
}

async function journey(prom: Prometheus, runId: string, windowSec: number, at: Date) {
  const q = journeyQueries(runId, windowSec);
  const [reached, completed, stepP95, paymentToConfirmation, integrity] = await Promise.all([
    prom.byLabel(q.reached, "step", at),
    prom.byLabel(q.completed, "step", at),
    prom.byLabel(q.stepP95, "step", at),
    prom.scalar(q.paymentToConfirmation, at),
    prom.byLabel(q.integrity, "item", at),
  ]);
  return journeySummary({ reached, completed, stepP95, paymentToConfirmation, integrity });
}

async function vitals(prom: Prometheus, runId: string, windowSec: number, at: Date) {
  const queries = Object.entries(browserQueries(runId, windowSec)) as [Vital, string][];
  const values = await Promise.all(queries.map(([, q]) => prom.byLabel(q, "name", at)));
  return browserSteps(Object.fromEntries(queries.map(([k], i) => [k, values[i]])) as Record<Vital, Record<string, number>>);
}
