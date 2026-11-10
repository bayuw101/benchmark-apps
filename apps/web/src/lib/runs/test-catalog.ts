import { RUNNER_PROTOCOL } from "@btb/contracts";

import type { Journey, ProjectCatalog, ScenarioVersion, Target } from "./catalog";
import type { DetailInputs, RunRecord } from "./detail";
import { evaluatePlan, manifestOf, type RunPlanInput } from "@btb/core/policy";
import type { SummaryRow } from "./results";

/*
 * Test-only data: a Ticketing catalog shaped like the old mock, so pure policy, scenario and report logic
 * can be tested without Postgres.
 */

const IMAGE = { name: "btb-runner", tag: "1.4.2-abc123", protocol: RUNNER_PROTOCOL, syncedAt: "2026-11-01T00:00:00Z" };

const p = (name: string, type: "string" | "number" | "boolean", value: string | number | boolean, extra: { min?: number; max?: number } = {}) => ({
  name,
  type,
  default: value,
  description: name,
  ...extra,
});

const JOURNEYS: Journey[] = [
  {
    id: "browse-event",
    title: "Find (browse event)",
    description: "Browser journey.",
    version: "1.3.0",
    browser: true,
    steps: ["Open event page"],
    params: [p("eventId", "string", "evt-demo-001")],
    budgets: [],
  },
  {
    id: "checkout",
    title: "Buy (checkout)",
    description: "Protocol journey.",
    version: "1.4.0",
    browser: false,
    steps: ["Select ticket", "Payment"],
    params: [p("ticketsPerOrder", "number", 2, { min: 1, max: 8 }), p("paymentMethod", "string", "card-sandbox"), p("retryOnDrop", "boolean", true)],
    budgets: [],
  },
  {
    id: "scan-ticket",
    title: "Enter (scan ticket)",
    description: "Arrival-rate journey.",
    version: "1.2.1",
    browser: false,
    steps: ["Validate QR"],
    params: [p("gates", "number", 8, { min: 1, max: 40 })],
    budgets: [],
  },
];

const t = (id: string, environment: Target["environment"], vus: number, rps: number): Target => ({
  id,
  name: id,
  environment,
  referencePeak: { vus, rps },
  hosts: [`${id}.perf.arbiter.test`],
  paths: ["/"],
  methods: ["GET", "POST"],
  redirects: [],
  healthPath: "/health",
  integrityPath: null,
});

const v = (version: number, journey: Journey, model: ScenarioVersion["model"], thresholds: ScenarioVersion["thresholds"] = { p95Ms: 800, errorRatePct: 1 }): ScenarioVersion => ({
  version,
  model,
  browser: journey.browser,
  thresholds,
  imageVersion: IMAGE.tag,
  runnerProtocol: IMAGE.protocol,
  params: Object.fromEntries(journey.params.map((jp) => [jp.name, jp.default])),
  createdBy: "Bayu Wicaksono",
  createdAt: "2026-10-01T00:00:00Z",
});

const [browse, checkout, scan] = JOURNEYS;

export const ticketing: ProjectCatalog = {
  targets: [t("tickets-staging", "staging", 1200, 1000), t("gate-api-staging", "staging", 2000, 3000), t("tickets-prodlike", "prod-like", 1200, 1000)],
  scenarios: [
    { name: "Checkout", journey: "checkout", versions: [v(4, checkout, "vus")] },
    { name: "Browse event", journey: "browse-event", versions: [v(6, browse, "vus")] },
    { name: "Scan ticket", journey: "scan-ticket", versions: [v(3, scan, "rps"), v(1, scan, "rps", null)] },
  ],
  ceilings: {
    staging: { vus: 10_000, rps: 8_000, durationSec: 14_400, rampPerMin: 8_000 },
    "prod-like": { vus: 2_000, rps: 1_500, durationSec: 1_800, rampPerMin: 1_000 },
  },
  journeys: JOURNEYS,
  image: IMAGE,
};

/** A finished run with a summary, ready for buildRunDetail. */
export function completedRun(plan: RunPlanInput, summary: Partial<SummaryRow> = {}, now = new Date("2026-11-07T10:00:00Z")): DetailInputs {
  const resolved = evaluatePlan(ticketing, plan).plan!;
  const manifest = manifestOf("arbiter-ticketing", resolved);
  const started = new Date(now.getTime() - 3_600_000);
  const run: RunRecord = {
    id: "RUN-0001",
    projectId: "arbiter-ticketing",
    scenario: { name: manifest.scenario.name, version: manifest.scenario.version },
    target: { id: manifest.target, name: manifest.target },
    environment: manifest.environment,
    preset: manifest.preset,
    status: "completed",
    releaseId: manifest.releaseId ?? undefined,
    createdBy: { name: "Bayu Wicaksono" },
    createdAt: started.toISOString(),
    startedAt: started.toISOString(),
    endedAt: new Date(started.getTime() + manifest.load.durationSec * 1000).toISOString(),
    durationSec: manifest.load.durationSec,
    verdict: { result: "pass", caveats: [] },
    manifest,
    manifestHash: "a".repeat(64),
    preflight: null,
    versions: { web: "1a2b3c4d5e6f", worker: "1a2b3c4d5e6f" },
    ref: { targetId: "t", scenarioId: "s", scenarioVersionId: "sv", createdById: "u" },
  } as RunRecord;
  return {
    run,
    projectName: "Ticketing",
    catalog: ticketing,
    approvals: [],
    timeline: [],
    summary: {
      runId: run.id,
      p50Ms: 120,
      p95Ms: 400,
      p99Ms: 700,
      errorRatePct: 0.2,
      peakRps: 900,
      maxVus: manifest.load.target,
      achievedLoad: manifest.load.target,
      achievedDurationSec: manifest.load.durationSec,
      gapSec: 0,
      browser: null,
      journey: null,
      oversoldSeats: null,
      doubleCharges: null,
      chargedNoTicket: null,
      createdAt: now,
      ...summary,
    },
    baseline: null,
    artifacts: [],
  };
}
