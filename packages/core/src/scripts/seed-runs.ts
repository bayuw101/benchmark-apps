/*
 * Example run history for development: finished runs with results (pass, fail, every abort kind), a release
 * trend, a baseline, and runs waiting on people (pending approval, approved, rejected). Lets UI work on the run
 * list, results, reports and approvals without the kind cluster.
 *   pnpm db:seed:runs       (after pnpm db:seed; does nothing when the project already has runs)
 *
 * The rows have the shape the web app and worker write (timeline actions, tones, preflight, summaries), but
 * the numbers are made up and there are no artifacts. No run is left starting/running/queued: the worker
 * would pick those up.
 */
import { RUNNER_IMAGE_NAME, type JourneySummary, type Preset, type Tone, type VerdictCaveat } from "@btb/contracts";
import { and, eq, inArray } from "drizzle-orm";

import { APPROVAL_VALIDITY_MS } from "../approvals";
import { approvals, auditLogs, baselines, createDb, runs, runSummaries, scenarios, scenarioVersions, targets, users, type DbOrTx } from "../db";
import { DEV_ACCOUNTS } from "../dev-accounts";
import { databaseUrl } from "../env";
import { hashManifest } from "../manifest";
import { autoApprovalRule, manifestOf, PRESETS, type ResolvedPlan } from "../policy";

const PROJECT_ID = "arbiter-ticketing";
const DAY = 86_400_000;
const MOCK = "mock-target.targets.svc.cluster.local:3000";

type Person = { id: string; name: string };
type Summary = Omit<typeof runSummaries.$inferInsert, "runId" | "createdAt">;
type AbortReason = NonNullable<typeof runs.$inferInsert.abortReason>;

interface Spec {
  scenario: string;
  target: "mock-target" | "mock-target-prod";
  preset: Preset;
  releaseId?: string;
  /** When it was created, ms before now. */
  ago: number;
  outcome:
    | { kind: "completed"; summary: Summary; caveats?: VerdictCaveat[]; baseline?: boolean }
    | { kind: "aborted" | "failed"; reason: AbortReason; detail: string; afterSec: number; summary?: Summary; stoppedBy?: "engineer" }
    | { kind: "pending_approval" | "approved" }
    | { kind: "rejected"; note: string };
}

/** Checkout funnel with `drop` share lost at each step after the first. */
function checkoutJourney(orders: number, drop = 0, confirmP95 = 640, broken = 0): JourneySummary {
  let reached = orders;
  const steps = ["Select ticket", "Cart", "Checkout", "Payment", "Confirmation"].map((step, i) => {
    const completed = Math.round(reached * (1 - (i === 0 ? 0 : drop)));
    const row = { step, reached, completed, p95Ms: step === "Confirmation" ? confirmP95 : 24 + i * 6 };
    reached = completed;
    return row;
  });
  const done = steps.at(-1)!.completed;
  return { steps, paymentToConfirmationP95Ms: confirmP95, counts: { order: done + broken, seat: done + broken, ticket: done, charge: done + broken } };
}

const summary = (s: Partial<Summary> & Pick<Summary, "p95Ms" | "errorRatePct" | "peakRps" | "maxVus" | "achievedDurationSec">): Summary => ({
  p50Ms: Math.round(s.p95Ms * 0.55),
  p99Ms: Math.round(s.p95Ms * 1.6),
  achievedLoad: s.maxVus,
  gapSec: 0,
  oversoldSeats: 0,
  doubleCharges: 0,
  chargedNoTicket: 0,
  ...s,
});

const RUNS: Spec[] = [
  // Release trend: Checkout baseline on prod-like, one run per release; the last release regressed.
  ...[
    ["2026.10.1", 30, 182, 0.08],
    ["2026.10.2", 23, 176, 0.05],
    ["2026.10.3", 16, 205, 0.11],
    ["2026.10.4", 9, 231, 0.12],
    ["2026.11.1", 2, 412, 0.31],
  ].map(([releaseId, days, p95, err], i): Spec => ({
    scenario: "Checkout",
    target: "mock-target-prod",
    preset: "baseline",
    releaseId: releaseId as string,
    ago: (days as number) * DAY,
    outcome: {
      kind: "completed",
      baseline: i === 3,
      summary: summary({ p95Ms: p95 as number, errorRatePct: err as number, peakRps: 43, maxVus: 10, achievedDurationSec: 910, journey: checkoutJourney(5100 - i * 40, (err as number) / 100) }),
    },
  })),
  {
    scenario: "Browse event",
    target: "mock-target",
    preset: "smoke",
    ago: 6 * DAY,
    outcome: { kind: "completed", summary: summary({ p95Ms: 38, errorRatePct: 0, peakRps: 9, maxVus: 5, achievedDurationSec: 130 }) },
  },
  {
    scenario: "Checkout",
    target: "mock-target",
    preset: "peak",
    releaseId: "2026.11.1",
    ago: 5 * DAY,
    outcome: {
      kind: "completed",
      // Fast and error-free, but the mock sold seats twice: integrity fails the verdict.
      summary: summary({ p95Ms: 96, errorRatePct: 0.02, peakRps: 81, maxVus: 20, achievedDurationSec: 910, oversoldSeats: 3, doubleCharges: 0, chargedNoTicket: 1, journey: checkoutJourney(9600, 0, 610, 3) }),
    },
  },
  {
    scenario: "Checkout",
    target: "mock-target",
    preset: "spike",
    releaseId: "2026.11.1",
    ago: 4 * DAY,
    outcome: {
      kind: "aborted",
      reason: "threshold",
      detail: "A threshold was crossed; k6 stopped the load.",
      afterSec: 140,
      summary: summary({ p95Ms: 1240, errorRatePct: 7.8, peakRps: 118, maxVus: 40, achievedDurationSec: 140, journey: checkoutJourney(2300, 0.09, 2900) }),
    },
  },
  {
    scenario: "Scan ticket",
    target: "mock-target",
    preset: "peak",
    ago: 3 * DAY,
    outcome: {
      kind: "aborted",
      reason: "emergency_stop",
      detail: "TestRun deleted; its runner pods are removed with it.",
      afterSec: 260,
      stoppedBy: "engineer",
      summary: summary({ p95Ms: 31, errorRatePct: 0, peakRps: 40, maxVus: 12, achievedDurationSec: 260 }),
    },
  },
  {
    scenario: "Receive ticket",
    target: "mock-target",
    preset: "baseline",
    ago: 2.5 * DAY,
    outcome: { kind: "aborted", reason: "target_health", detail: "The target failed 3 health probes in a row (/healthz: HTTP 503).", afterSec: 410, summary: summary({ p95Ms: 880, errorRatePct: 12.4, peakRps: 22, maxVus: 10, achievedDurationSec: 410 }) },
  },
  {
    scenario: "Checkout",
    target: "mock-target",
    preset: "smoke",
    ago: 2 * DAY,
    outcome: { kind: "failed", reason: "kubernetes_failure", detail: "1 of 1 runner pod disappeared (deleted or evicted) before the run ended; any other runners were stopped.", afterSec: 18 },
  },
  {
    scenario: "Checkout",
    target: "mock-target",
    preset: "baseline",
    releaseId: "2026.11.1",
    ago: 1.5 * DAY,
    outcome: {
      kind: "completed",
      caveats: ["measurement_gap"],
      summary: summary({ p95Ms: 142, errorRatePct: 0.1, peakRps: 43, maxVus: 10, achievedDurationSec: 910, gapSec: 25, journey: checkoutJourney(5050, 0.001) }),
    },
  },
  { scenario: "Checkout", target: "mock-target-prod", preset: "peak", releaseId: "2026.11.2", ago: 20 * 3_600_000, outcome: { kind: "rejected", note: "Peak on prod-like overlaps the ticketing release window on Thursday. Move it to Friday morning." } },
  { scenario: "Checkout", target: "mock-target-prod", preset: "baseline", releaseId: "2026.11.2", ago: 3 * 3_600_000, outcome: { kind: "pending_approval" } },
  { scenario: "Checkout", target: "mock-target", preset: "stress", releaseId: "2026.11.2", ago: 2 * 3_600_000, outcome: { kind: "approved" } },
];

const PREFLIGHT_PASS = {
  approval: { state: "pass", reason: "Manifest matches its approvals." },
  target: { state: "pass" },
  window: { state: "pass", reason: "No blackout windows are configured yet." },
  test_data: { state: "pass", reason: "Seed hook POST /__admin/reset ran." },
  target_health: { state: "pass", reason: `${MOCK}/healthz answered.` },
  monitoring: { state: "pass", reason: "Prometheus is ready." },
  runner_capacity: { state: "pass", reason: "Room for 1 runner (kubernetes)." },
} as const;

const END: Record<AbortReason, { action: string; tone: Tone }> = {
  threshold: { action: "Aborted: threshold crossed", tone: "danger" },
  emergency_stop: { action: "Stopped", tone: "warning" },
  target_health: { action: "Aborted: target unhealthy", tone: "danger" },
  telemetry_lost: { action: "Aborted: telemetry lost", tone: "danger" },
  lease_expired: { action: "Aborted: runner lease lost", tone: "danger" },
  policy_breach: { action: "Aborted: runner refused to start", tone: "danger" },
  kubernetes_failure: { action: "Failed", tone: "danger" },
};

const numbers = (s: Summary) => ` p95 ${s.p95Ms} ms, errors ${s.errorRatePct}%, peak ${s.peakRps} RPS.`;

async function seedRun(tx: DbOrTx, spec: Spec, people: Record<"engineer" | "approver" | "approver2", Person>, now: number) {
  const [target] = await tx.select().from(targets).where(and(eq(targets.projectId, PROJECT_ID), eq(targets.name, spec.target)));
  const [{ scenario, version }] = await tx
    .select({ scenario: scenarios, version: scenarioVersions })
    .from(scenarios)
    .innerJoin(scenarioVersions, eq(scenarioVersions.scenarioId, scenarios.id))
    .where(and(eq(scenarios.projectId, PROJECT_ID), eq(scenarios.name, spec.scenario), eq(scenarioVersions.version, 1)));

  const p = PRESETS[spec.preset];
  const environment = target.environment as ResolvedPlan["environment"];
  const approvers = environment === "prod-like" ? 2 : p.risky ? 1 : 0;
  const plan: ResolvedPlan = {
    scenario: { name: scenario.name, journey: scenario.journeyId, versions: [] },
    version: {
      version: version.version,
      model: version.model,
      browser: version.browser,
      thresholds: version.p95Ms !== null && version.errorRatePct !== null ? { p95Ms: version.p95Ms, errorRatePct: version.errorRatePct } : null,
      imageVersion: version.imageTag,
      runnerProtocol: 2,
      params: version.params,
      createdBy: "",
      createdAt: "",
    },
    target: { id: target.name, name: target.name, environment, referencePeak: { vus: target.peakVus, rps: target.peakRps }, hosts: target.hosts, paths: target.paths, methods: [], redirects: [], healthPath: target.healthPath, integrityPath: target.integrityPath },
    environment,
    preset: spec.preset,
    network: null,
    releaseId: spec.releaseId,
    load: p.fixed ?? Math.round((version.model === "vus" ? target.peakVus : target.peakRps) * p.factor),
    model: version.model,
    durationSec: p.durationSec,
    rampSec: p.rampSec,
    approvers,
  };
  const manifest = manifestOf(PROJECT_ID, plan);
  const manifestHash = hashManifest(manifest);
  const short = manifestHash.slice(0, 12);

  // Timeline: [seconds after creation, actor (null = system), action, detail, tone, data]
  const tl: [number, Person | null, string, string | null, Tone | null, Record<string, unknown>?][] = [];
  const created = now - spec.ago;
  const at = (sec: number) => new Date(created + sec * 1000);
  tl.push([0, people.engineer, "Created", null, null]);
  tl.push([0.001, people.engineer, approvers ? `Submitted for approval (${approvers} ${approvers === 1 ? "approver" : "approvers"})` : "Submitted", `Manifest ${short}`, null]);

  const o = spec.outcome;
  const approvalRows: (typeof approvals.$inferInsert)[] = [];
  const approve = (who: Person, sec: number, n: number) => {
    approvalRows.push({ runId: "", userId: who.id, manifestHash, decision: "approved", createdAt: at(sec), expiresAt: new Date(at(sec).getTime() + APPROVAL_VALIDITY_MS) });
    tl.push([sec, who, "Approved", `${Math.min(n, approvers)} of ${approvers} for manifest ${short}.`, "success"]);
  };
  if (approvers === 0) {
    approvalRows.push({ runId: "", userId: null, rule: autoApprovalRule(environment, spec.preset), manifestHash, decision: "approved", createdAt: at(0.002), expiresAt: new Date(at(0.002).getTime() + APPROVAL_VALIDITY_MS) });
    tl.push([0.002, null, "Auto-approved", autoApprovalRule(environment, spec.preset), "success"]);
  } else if (o.kind === "rejected") {
    approvalRows.push({ runId: "", userId: people.approver.id, manifestHash, decision: "rejected", note: o.note, createdAt: at(1800) });
    tl.push([1800, people.approver, "Rejected", o.note, "danger"]);
  } else if (o.kind === "pending_approval") {
    if (approvers === 2) approve(people.approver, 1200, 1);
  } else {
    approve(people.approver, 900, 1);
    if (approvers === 2) approve(people.approver2, 1500, 2);
  }

  const row: typeof runs.$inferInsert = {
    projectId: PROJECT_ID,
    scenarioVersionId: version.id,
    targetId: target.id,
    environment,
    preset: spec.preset,
    releaseId: spec.releaseId ?? null,
    status: o.kind,
    manifest: manifest as unknown as Record<string, unknown>,
    manifestHash,
    durationSec: p.durationSec,
    createdBy: people.engineer.id,
    createdAt: at(0),
    submittedAt: at(0.001),
    updatedAt: at(1800),
  };

  let sum: Summary | undefined;
  if (o.kind === "completed" || o.kind === "aborted" || o.kind === "failed") {
    const start = approvers ? 2400 : 60;
    const ranSec = o.kind === "completed" ? p.durationSec + 10 : o.afterSec;
    const end = start + 20 + ranSec;
    const testRun = `TestRun run-xxxx in perf-${environment === "prod-like" ? "prod" : "staging"}: 1 runner pod, ${RUNNER_IMAGE_NAME}:${version.imageTag}.`;
    tl.push([start, people.engineer, "Start requested", null, null]);
    tl.push([start + 0.001, null, "Preflight passed", "Approval, target, window and test data. The worker checks the rest.", "success"]);
    tl.push([start + 0.02, null, "Preflight passed", "Target health, monitoring, runner capacity and test data.", "success"]);
    tl.push([start + 0.03, null, "Starting", testRun, "info"]);
    tl.push([start + 5, null, "Runner verified", "run-1: manifest hash, approvals and allowlist checked before load.", "info", { pod: "run-1", callback: "verified" }]);
    tl.push([start + 8, null, "Runners started", "Runners run their self-check, then send load.", "info"]);
    if (o.kind !== "completed" && o.stoppedBy) tl.push([end - 4, people.engineer, "Emergency stop", "TestRun deleted; runner pods stopping.", "danger"]);

    sum = o.summary;
    const integrity = sum && sum.oversoldSeats !== null && sum.oversoldSeats !== undefined;
    const clean = integrity && !sum!.oversoldSeats && !sum!.doubleCharges && !sum!.chargedNoTicket;
    let verdict: "pass" | "fail" | null = null;
    if (o.kind === "completed") {
      const t = plan.version.thresholds!;
      const held = sum!.p95Ms <= t.p95Ms && sum!.errorRatePct <= t.errorRatePct;
      verdict = held && (!integrity || clean) ? "pass" : "fail";
      const iterations = sum!.journey?.steps.at(-1)?.completed ?? sum!.peakRps * sum!.achievedDurationSec;
      tl.push([end - 6, null, "Runner finished", `run-1: ${iterations} iterations, thresholds ${held ? "held" : "crossed"}.`, held ? "success" : "warning", { pod: "run-1", callback: "finished", iterations, thresholdsOk: held }]);
    } else if (o.reason === "threshold") verdict = "fail";
    const caveats: VerdictCaveat[] = o.kind === "completed" ? (o.caveats ?? []) : sum && !integrity ? ["integrity_not_verified"] : [];
    if (integrity) {
      const d = `${sum!.oversoldSeats} oversold seats, ${sum!.doubleCharges} double charges, ${sum!.chargedNoTicket} charged without a ticket (${MOCK}/__admin/integrity).`;
      const counts = { oversoldSeats: sum!.oversoldSeats, doubleCharges: sum!.doubleCharges, chargedNoTicket: sum!.chargedNoTicket };
      tl.push([end, null, clean ? "Integrity verified" : "Integrity broken", d, clean ? "success" : "danger", { integrity: counts }]);
    }
    const ending =
      o.kind === "completed"
        ? { action: "Completed", detail: `Verdict: ${verdict}.${numbers(sum!)}`, tone: (verdict === "pass" ? "success" : "danger") as Tone }
        : { action: END[o.reason].action, detail: `${o.detail}${sum && o.reason !== "telemetry_lost" ? numbers(sum) : ""}`, tone: END[o.reason].tone };
    tl.push([end + 0.002, null, ending.action, ending.detail, ending.tone, { verdict, caveats }]);
    tl.push([end + 1, null, "Test data cleaned up", "Cleanup hook POST /__admin/reset ran.", "success"]);

    Object.assign(row, {
      startRequestedAt: at(start),
      startedAt: at(start + 8),
      endedAt: at(end),
      updatedAt: at(end),
      preflight: PREFLIGHT_PASS,
      abortReason: o.kind === "completed" ? null : o.reason,
      verdict,
      caveats,
    });
  }

  const [{ id }] = await tx.insert(runs).values(row).returning({ id: runs.id });
  if (approvalRows.length) await tx.insert(approvals).values(approvalRows.map((a) => ({ ...a, runId: id })));
  if (sum) await tx.insert(runSummaries).values({ runId: id, ...sum, createdAt: new Date(row.endedAt as Date) });
  const pod = `${id.toLowerCase()}-1`;
  await tx.insert(auditLogs).values(
    tl.map(([sec, actor, action, detail, tone, data]) => ({
      at: at(sec),
      actorId: actor?.id ?? null,
      actorName: actor?.name ?? "System",
      action,
      detail: detail?.replace("run-xxxx", id.toLowerCase()).replace(/^run-1:/, `${pod}:`) ?? null,
      projectId: PROJECT_ID,
      runId: id,
      data: tone || data ? { ...(data?.pod ? { ...data, pod } : data), ...(tone ? { tone } : {}) } : null,
    })),
  );
  if (o.kind === "completed" && o.baseline) {
    await tx.insert(baselines).values({ targetId: target.id, scenarioId: scenario.id, preset: spec.preset, runId: id, setBy: people.engineer.id, setAt: at(4000) });
    await tx.insert(auditLogs).values({
      at: at(4000),
      actorId: people.engineer.id,
      actorName: people.engineer.name,
      action: "Set as baseline",
      detail: `For ${scenario.name} (${spec.preset}) on ${target.name}.`,
      projectId: PROJECT_ID,
      runId: id,
      data: { tone: "info" },
    });
  }
  return `${id} ${o.kind}`;
}

const { db, pool } = createDb({ connectionString: databaseUrl() });
try {
  const [existing] = await db.select({ id: runs.id }).from(runs).where(eq(runs.projectId, PROJECT_ID)).limit(1);
  if (existing) {
    console.log(`project ${PROJECT_ID} already has runs; example runs not added`);
  } else {
    const emails = { engineer: "engineer@example.com", approver: "approver@example.com", approver2: "approver2@example.com" };
    const rows = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.email, Object.values(emails)));
    const person = (email: string) => {
      const u = rows.find((r) => r.email === email);
      if (!u) throw new Error(`${email} is missing: run pnpm db:seed first (accounts: ${DEV_ACCOUNTS.map((a) => a.key).join(", ")})`);
      return { id: u.id, name: u.name };
    };
    const people = { engineer: person(emails.engineer), approver: person(emails.approver), approver2: person(emails.approver2) };
    const now = Date.now();
    const done = await db.transaction(async (tx) => {
      const out: string[] = [];
      for (const spec of RUNS) out.push(await seedRun(tx, spec, people, now));
      return out;
    });
    console.log(`seeded ${done.length} example runs: ${done.join(", ")}`);
  }
} finally {
  await pool.end();
}
