import { BROWSER_SCENARIO, LEASE_SCENARIO, type NetworkProfile, type RunnerConfig } from "@btb/contracts";
import type { Options, Scenario } from "k6/options";

/** Abort on a threshold only after this long, so warm-up noise doesn't kill a run (PRD E3.5). */
export const ABORT_EVAL_DELAY = "30s";

const s = (sec: number) => `${Math.round(sec)}s`;

/** The k6 load profile for a run. Load is the total; k6-operator splits it across runner pods. */
export function scenarioOf(c: RunnerConfig): Scenario {
  const hold = Math.max(c.durationSec - c.rampSec, 0);
  const stages = [{ duration: s(c.rampSec), target: c.load }, ...(hold ? [{ duration: s(hold), target: c.load }] : [])];

  if (c.model === "vus") {
    return c.rampSec
      ? { executor: "ramping-vus", startVUs: 0, stages, gracefulRampDown: "10s", gracefulStop: "10s" }
      : { executor: "constant-vus", vus: c.load, duration: s(c.durationSec), gracefulStop: "10s" };
  }
  // Open model: iterations per second. VUs are only the pool that serves the arrivals.
  const preAllocatedVUs = Math.max(1, Math.ceil(c.load));
  const maxVUs = preAllocatedVUs * 3;
  return c.rampSec
    ? { executor: "ramping-arrival-rate", startRate: 0, timeUnit: "1s", preAllocatedVUs, maxVUs, stages, gracefulStop: "10s" }
    : { executor: "constant-arrival-rate", rate: c.load, timeUnit: "1s", duration: s(c.durationSec), preAllocatedVUs, maxVUs, gracefulStop: "10s" };
}

/** Exported by the runner entry point; runs the lease scenario. */
export const LEASE_EXEC = "lease";
/** Exported by the runner entry point; runs the journey's browser steps. */
export const BROWSER_EXEC = "browser";

/**
 * PROPOSAL (PRD story 6, values TBD): Stadium 4G = a congested cell: 400 ms latency, ~1.6 Mbit/s down,
 * ~750 kbit/s up, a mid-range phone CPU (4× slowdown). Wi-Fi baseline = no throttling.
 */
export const THROTTLE: Record<NetworkProfile, { latency: number; download: number; upload: number; cpuRate: number } | null> = {
  "stadium-4g": { latency: 400, download: 200 * 1024, upload: 94 * 1024, cpuRate: 4 },
  "wifi-baseline": null,
};

export function optionsOf(c: RunnerConfig): Options {
  const options: Options = {
    scenarios: {
      [c.journey]: scenarioOf(c),
      // One VU per runner pod: k6-operator splits `vus` evenly across the pods.
      [LEASE_SCENARIO]: { executor: "constant-vus", vus: c.runners, duration: s(c.durationSec), exec: LEASE_EXEC, gracefulStop: "0s" },
      ...(c.browser && {
        [BROWSER_SCENARIO]: {
          executor: "constant-vus",
          vus: c.browser.vus,
          duration: s(c.durationSec),
          exec: BROWSER_EXEC,
          gracefulStop: "10s",
          options: { browser: { type: "chromium" } },
        },
      }),
    },
    summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
  };
  if (c.thresholds) {
    // abortOnFail: the run stops as soon as a threshold is crossed (exit code 99), not at the end.
    // Scoped to the journey so lease check-ins don't count.
    const of = (metric: string) => `${metric}{scenario:${c.journey}}`;
    options.thresholds = {
      [of("http_req_duration")]: [{ threshold: `p(95)<${c.thresholds.p95Ms}`, abortOnFail: true, delayAbortEval: ABORT_EVAL_DELAY }],
      [of("http_req_failed")]: [{ threshold: `rate<${c.thresholds.errorRatePct / 100}`, abortOnFail: true, delayAbortEval: ABORT_EVAL_DELAY }],
    };
  }
  return options;
}
