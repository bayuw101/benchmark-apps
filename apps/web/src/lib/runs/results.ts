import type { BrowserStep, JourneySummary, RunManifest } from "@btb/contracts";
import type { runSummaries } from "@btb/core/schema";

import { UNIT } from "@btb/core/policy";
import type { RunDetail, RunResults, VerdictCaveat } from "./types";

/*
 * Run results (UI-10, PRD E9.1–E9.4): the worker's end-of-run summary (run_summaries), read against the
 * thresholds and planned load in the run's manifest.
 */

/** PRD default budgets (E7.8) for browser steps. */
export const BROWSER_BUDGETS = { lcpMs: 2500, inpMs: 200, cls: 0.1, fcpMs: 1800, ttfbMs: 800 };

/** LCP, INP, CLS, FCP, TTFB cells of a browser step against the budgets. A vital the run didn't report shows "—". */
export function browserCells(s: BrowserStep): { text: string; ok: boolean }[] {
  const sec = (n: number) => `${(n / 1000).toFixed(2)} s`;
  const cell = (v: number | null, budget: number, text: (n: number) => string) => (v === null ? { text: "—", ok: true } : { text: text(v), ok: v <= budget });
  return [
    cell(s.lcpMs, BROWSER_BUDGETS.lcpMs, sec),
    cell(s.inpMs, BROWSER_BUDGETS.inpMs, (n) => `${n} ms`),
    cell(s.cls, BROWSER_BUDGETS.cls, (n) => n.toFixed(2)),
    cell(s.fcpMs, BROWSER_BUDGETS.fcpMs, sec),
    cell(s.ttfbMs, BROWSER_BUDGETS.ttfbMs, sec),
  ];
}

/** PRD default budget (Buy): payment submitted to order confirmed, p95. */
export const PAYMENT_CONFIRMATION_BUDGET_MS = 3000;

/** Funnel steps in the journey's declared order; steps the journey doesn't declare keep their place after them. */
export function journeyOf(j: JourneySummary | null, declared: string[] = []): JourneySummary | null {
  if (!j) return null;
  const rank = (step: string) => (declared.includes(step) ? declared.indexOf(step) : declared.length);
  return { ...j, steps: [...j.steps].sort((a, b) => rank(a.step) - rank(b.step)) };
}

/** "2 double charges, 1 charge without a ticket", or null when integrity is clean or wasn't checked. */
export function integrityBreach(i: RunResults["integrity"]): string | null {
  if (!i) return null;
  const n = (k: number, one: string, many: string) => (k ? `${k} ${k === 1 ? one : many}` : null);
  const parts = [n(i.oversoldSeats, "oversold seat", "oversold seats"), n(i.doubleCharges, "double charge", "double charges"), n(i.chargedNoTicket, "charge without a ticket", "charges without a ticket")].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** Integrity is missing because the target's source didn't answer (the worker's timeline entry), not because there is none. */
export const integritySourceFailed = (d: Pick<RunDetail, "timeline">) => d.timeline.some((e) => e.label === "Integrity not verified");

export type SummaryRow = typeof runSummaries.$inferSelect;

export function resultsOf(manifest: RunManifest, durationSec: number, caveats: VerdictCaveat[], s: SummaryRow | null, steps?: string[]): RunResults | null {
  if (!s) return null;
  const t = manifest.thresholds ? { p95Ms: manifest.thresholds.p95Ms, errorRatePct: manifest.thresholds.errorRatePct } : null;
  return {
    p50Ms: s.p50Ms,
    p95Ms: s.p95Ms,
    p99Ms: s.p99Ms,
    errorRatePct: s.errorRatePct,
    peakRps: s.peakRps,
    maxVus: s.maxVus,
    planned: { load: manifest.load.target, unit: UNIT[manifest.load.model], durationSec },
    achieved: { load: s.achievedLoad, durationSec: s.achievedDurationSec },
    thresholds: t,
    checks: { p95: !t || s.p95Ms <= t.p95Ms, errors: !t || s.errorRatePct <= t.errorRatePct },
    gapSec: s.gapSec,
    browser: s.browser,
    journey: journeyOf(s.journey, steps),
    integrity:
      s.oversoldSeats === null || s.doubleCharges === null || s.chargedNoTicket === null
        ? null
        : { oversoldSeats: s.oversoldSeats, doubleCharges: s.doubleCharges, chargedNoTicket: s.chargedNoTicket },
    caveats,
  };
}
