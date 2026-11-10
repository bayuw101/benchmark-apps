import {
  BROWSER_SCENARIO,
  K6_SCRIPT_ABORTED_EXIT,
  K6_SUMMARY_MARKER,
  K6_THRESHOLDS_FAILED_EXIT,
  LEASE_SCENARIO,
  RUNNER_ARTIFACTS_PATH,
  RUNNER_CALLBACK_PATH,
  RUNNER_CONFIG_ENV,
  RUNNER_IMAGE_NAME,
  RUNNER_MANIFEST_PATH,
  RUNNER_SCRIPT_PATH,
  RUNNER_TEST_DATA_DIR,
  targetUrl,
  testDataSecretName,
} from "@btb/contracts";
import type { ExecutionSpec, ExecutionStatus, RunnerExit } from "@btb/core/executor";
import { integrityClean, type IntegrityCounts } from "@btb/core/integrity";
import type { AbortReason, BrowserStep, IntegrityItem, JourneySummary, LoadModel, RunManifest, RunnerCallback, RunnerConfig, RunnerLease, VerdictCaveat } from "@btb/contracts";

/*
 * Pure decisions of the worker: what to start, what a TestRun looks like, how a finished run is judged.
 * No I/O here, so all of it is unit-tested.
 */

export interface TargetAllowlist {
  /** Target name: the test-data Secret is named after it. */
  name: string;
  hosts: string[];
  paths: string[];
  methods: string[];
}

const RUN_ID = /^RUN-\d+$/;

/** Run ids go into PromQL and Kubernetes names; refuse anything that isn't next_run_id()'s shape. */
export function assertRunId(id: string) {
  if (!RUN_ID.test(id)) throw new Error(`Unexpected run id "${id}"`);
  return id;
}

/* ---------- Scheduling (E3.5): 1 active run per target, N per namespace, FIFO by start request ---------- */

export interface QueuedRun {
  id: string;
  targetId: string;
  namespace: string;
}
export type ActiveRun = QueuedRun;
export type Decision = { id: string; start: true } | { id: string; start: false; behind: string };

export function schedule(queued: QueuedRun[], active: ActiveRun[], perNamespace: number): Decision[] {
  const byTarget = new Map(active.map((a) => [a.targetId, a.id]));
  const byNamespace = new Map<string, string[]>();
  for (const a of active) byNamespace.set(a.namespace, [...(byNamespace.get(a.namespace) ?? []), a.id]);

  return queued.map((q): Decision => {
    const holder = byTarget.get(q.targetId);
    if (holder) return { id: q.id, start: false, behind: holder };
    const inNamespace = byNamespace.get(q.namespace) ?? [];
    if (inNamespace.length >= perNamespace) return { id: q.id, start: false, behind: inNamespace[0] };
    // Claimed for this pass: later runs on the same target / namespace wait behind it.
    byTarget.set(q.targetId, q.id);
    byNamespace.set(q.namespace, [...inNamespace, q.id]);
    return { id: q.id, start: true };
  });
}

/* ---------- TestRun ---------- */

/** PROPOSAL: one runner pod per 200 VUs (or iterations/s), capped by WORKER_MAX_PARALLELISM. */
export const LOAD_PER_RUNNER = 200;

export function parallelismFor(load: number, max: number) {
  return Math.min(max, Math.max(1, Math.ceil(load / LOAD_PER_RUNNER)));
}

/** Per runner pod; the perf-* LimitRange gives the initializer/starter pods the same requests. */
export const RUNNER_RESOURCES = {
  requests: { cpu: "100m", memory: "128Mi" },
  limits: { cpu: "500m", memory: "256Mi" },
};

/** PROPOSAL (N11 TBD): Chromium per pod, sized for BROWSER_VUS_PER_POD headless pages. */
export const BROWSER_RUNNER_RESOURCES = {
  requests: { cpu: "500m", memory: "512Mi" },
  limits: { cpu: "1500m", memory: "1Gi" },
};

/**
 * Browser VUs per runner pod; they run next to the protocol load, not instead of it. Measured in M5.2
 * (docs/evidence/m5/browser-vus.md): one VU already uses the pod's 1.5 CPU, more VUs only inflate the vitals
 * (median LCP 104 ms at 1 VU, 156 at 2, 408 at 4) and 6 hit the 1 Gi limit. Keep at 1.
 */
export const BROWSER_VUS_PER_POD = 1;

export const runnerResources = (browser: boolean) => (browser ? BROWSER_RUNNER_RESOURCES : RUNNER_RESOURCES);

/**
 * Go soft memory limit for k6, 80% of the pod's memory limit. Without it the Go heap grows until the cgroup
 * OOM-kills the pod: measured in M5.3 (docs/evidence/m5/calibration.md), ~165 bytes per request at 1000 RPS
 * kept climbing past 170 MiB, while with GOMEMLIMIT the same load levelled off just under the limit.
 */
export const goMemLimit = (browser: boolean) => `${Math.floor((parseQuantity(runnerResources(browser).limits.memory) * 0.8) / 2 ** 20)}MiB`;

export const testRunName = (runId: string) => assertRunId(runId).toLowerCase();

export { targetUrl };

/** PROPOSAL (E6.1): runners check in every 10 s and give up after 60 s without an answer. */
export const LEASE_EVERY_SEC = 10;
export const LEASE_GRACE_SEC = 60;
/** Decided 2026-11-08: the runner token outlives the planned run by this much (start-up, overrun grace, last uploads). */
export const TOKEN_SLACK_SEC = 30 * 60;

export const tokenExpiry = (nowMs: number, durationSec: number) => Math.ceil(nowMs / 1000) + durationSec + TOKEN_SLACK_SEC;

export function runnerConfig(
  runId: string,
  manifestHash: string,
  m: RunManifest,
  t: TargetAllowlist,
  runners: number,
  lease: RunnerLease,
  /** Identities in the target's test-data pool; null when it has none. */
  testDataTotal: number | null = null,
): RunnerConfig {
  if (!t.hosts.length) throw new Error("Target has no hosts");
  const platform = (path: string) => new URL(path, lease.url).toString();
  return {
    runId,
    manifestHash,
    manifestUrl: platform(RUNNER_MANIFEST_PATH),
    callbackUrl: platform(RUNNER_CALLBACK_PATH),
    journey: m.scenario.journey,
    params: m.params,
    model: m.load.model,
    load: m.load.target,
    durationSec: m.load.durationSec,
    rampSec: m.load.rampSec,
    thresholds: m.thresholds ? { p95Ms: m.thresholds.p95Ms, errorRatePct: m.thresholds.errorRatePct } : null,
    targetUrl: targetUrl(t.hosts[0]),
    allowedHosts: t.hosts,
    allowedPaths: t.paths,
    allowedMethods: t.methods,
    runners,
    lease,
    // Policy sets a network profile exactly when the scenario version has browser steps.
    browser: m.network
      ? { vus: runners * BROWSER_VUS_PER_POD, network: m.network, artifactsUrl: platform(RUNNER_ARTIFACTS_PATH) }
      : null,
    testData: testDataTotal === null ? null : { secret: testDataSecretName(t.name), total: testDataTotal },
  };
}

export interface TestRunInput {
  runId: string;
  namespace: string;
  /** `btb-runner:<tag>`, with the registry prefix if any. */
  image: string;
  parallelism: number;
  config: RunnerConfig;
  remoteWriteUrl: string;
}

export const runnerImage = (registry: string, tag: string) => `${registry}${RUNNER_IMAGE_NAME}:${tag}`;

export const RUN_ID_LABEL = "btb.io/run-id";

export function testRunManifest(i: TestRunInput) {
  return {
    apiVersion: "k6.io/v1alpha1",
    kind: "TestRun",
    metadata: {
      name: testRunName(i.runId),
      namespace: i.namespace,
      labels: { [RUN_ID_LABEL]: i.runId, "app.kubernetes.io/managed-by": "btb-worker" },
    },
    spec: {
      parallelism: i.parallelism,
      script: { localFile: RUNNER_SCRIPT_PATH },
      // testid ties every Prometheus series to the run (live loop + summary queries).
      arguments: `--tag testid=${i.runId} -o experimental-prometheus-rw`,
      runner: {
        image: i.image,
        imagePullPolicy: "IfNotPresent",
        resources: runnerResources(!!i.config.browser),
        // E2.6: the identities come from the Secret, read by the runner. Optional, so a missing Secret makes the
        // runner refuse with a reason (self-check) instead of the pod hanging in ContainerCreating.
        ...(i.config.testData
          ? {
              volumes: [{ name: "test-data", secret: { secretName: i.config.testData.secret, optional: true } }],
              volumeMounts: [{ name: "test-data", mountPath: RUNNER_TEST_DATA_DIR, readOnly: true }],
            }
          : {}),
        env: [
          { name: RUNNER_CONFIG_ENV, value: JSON.stringify(i.config) },
          { name: "K6_PROMETHEUS_RW_SERVER_URL", value: i.remoteWriteUrl },
          { name: "K6_FEATURES", value: "native-histograms" },
          { name: "GOMEMLIMIT", value: goMemLimit(!!i.config.browser) },
        ],
      },
    },
  };
}

/* ---------- Runner capacity (preflight) ---------- */

/** Kubernetes quantity -> milli-units (cpu) or bytes (memory). Covers what quotas and limits use. */
export function parseQuantity(q: string): number {
  const m = /^(\d+(?:\.\d+)?)(m|k|Ki|Mi|Gi|Ti|M|G|T)?$/.exec(q.trim());
  if (!m) throw new Error(`Unsupported quantity "${q}"`);
  const n = Number(m[1]);
  const unit = m[2] ?? "";
  const factor: Record<string, number> = {
    "": 1,
    m: 0.001,
    k: 1e3,
    M: 1e6,
    G: 1e9,
    T: 1e12,
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
  };
  return n * factor[unit];
}

export interface QuotaStatus {
  hard: Record<string, string>;
  used: Record<string, string>;
}

/** What a TestRun with `parallelism` runners needs at its peak: the runners plus the starter pod. */
export function capacityNeed(parallelism: number, browser: boolean): Record<string, number> {
  const runner = runnerResources(browser);
  const q = (pick: (r: typeof RUNNER_RESOURCES) => string) => parallelism * parseQuantity(pick(runner)) + parseQuantity(pick(RUNNER_RESOURCES));
  return {
    pods: parallelism + 1,
    "requests.cpu": q((r) => r.requests.cpu),
    "requests.memory": q((r) => r.requests.memory),
    "limits.cpu": q((r) => r.limits.cpu),
    "limits.memory": q((r) => r.limits.memory),
  };
}

/** Null when every quota has room, else the first resource that doesn't. */
export function capacityShortfall(quotas: QuotaStatus[], need: Record<string, number>): string | null {
  for (const q of quotas) {
    for (const [resource, amount] of Object.entries(need)) {
      const hard = q.hard[resource] ?? q.hard[resource.replace(/^requests\./, "")];
      if (hard === undefined) continue;
      const used = q.used[resource] ?? q.used[resource.replace(/^requests\./, "")] ?? "0";
      const free = parseQuantity(hard) - parseQuantity(used);
      if (free < amount - 1e-9) return `${resource}: needs ${fmt(resource, amount)}, ${fmt(resource, Math.max(free, 0))} free`;
    }
  }
  return null;
}

function fmt(resource: string, n: number) {
  if (resource.endsWith("cpu")) return `${Math.round(n * 1000)}m`;
  if (resource.endsWith("memory")) return `${Math.round(n / 1024 ** 2)}Mi`;
  return String(n);
}

/** In-cluster service behind a target host, for the health probe through the API server. */
export function clusterService(host: string): { name: string; namespace: string; port: number } | null {
  const m = /^([a-z0-9-]+)\.([a-z0-9-]+)\.svc(?:\.cluster\.local)?(?::(\d+))?$/.exec(host);
  return m ? { name: m[1], namespace: m[2], port: m[3] ? Number(m[3]) : 80 } : null;
}

/* ---------- Outcome + verdict ---------- */

export type Outcome =
  | { status: "completed"; abortReason: null; detail: string }
  | { status: "aborted" | "failed"; abortReason: AbortReason; detail: string };

/** A finished TestRun, judged by its runner pods' exit codes. */
export function outcomeOf(exitCodes: (number | null)[]): Outcome {
  if (!exitCodes.length) return { status: "failed", abortReason: "kubernetes_failure", detail: "No runner pods were found." };
  if (exitCodes.includes(K6_THRESHOLDS_FAILED_EXIT)) {
    return { status: "aborted", abortReason: "threshold", detail: "A threshold was crossed; k6 stopped the load." };
  }
  if (exitCodes.includes(K6_SCRIPT_ABORTED_EXIT)) {
    return { status: "aborted", abortReason: "lease_expired", detail: "A runner lost its lease and stopped the load." };
  }
  if (exitCodes.every((c) => c === 0)) return { status: "completed", abortReason: null, detail: "All runner pods finished." };
  const codes = exitCodes.map((c) => (c === null ? "?" : String(c))).join(", ");
  return { status: "failed", abortReason: "kubernetes_failure", detail: `Runner pods exited with ${codes}.` };
}

/**
 * The second result signal (E5.4): what the pods reported themselves. A refusal in the self-check outranks the
 * exit codes (k6 exits 108 for it, like a lost lease); a lease stop gets the runner's own reason.
 * `missing` = runner pods (by name) that sent none of `finished`, `refused` or `stopped`.
 */
export function withCallbacks(outcome: Outcome, callbacks: RunnerCallback[], podNames: string[]): { outcome: Outcome; missing: string[] } {
  // `stopped` counts: a pod cut off mid-run reports that instead of `finished` (finalCallback in k6-lib).
  const reported = new Set(callbacks.filter((c) => c.event === "finished" || c.event === "refused" || c.event === "stopped").map((c) => c.pod));
  // Pod names are `<hostname>-<random>`; the runner only knows its hostname.
  const missing = podNames.filter((p) => ![...reported].some((h) => p.startsWith(`${h}-`)));
  const refused = callbacks.find((c) => c.event === "refused");
  if (refused) {
    return { outcome: { status: "aborted", abortReason: "policy_breach", detail: `A runner refused to start, no load was sent: ${refused.reason ?? "no reason given"}.` }, missing };
  }
  const stopped = callbacks.find((c) => c.event === "stopped");
  if (outcome.abortReason === "lease_expired" && stopped?.reason) {
    return { outcome: { ...outcome, detail: `A runner stopped the load (${stopped.reason}).` }, missing };
  }
  return { outcome, missing };
}

export interface SummaryNumbers {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  errorRatePct: number;
  peakRps: number;
  maxVus: number;
  achievedLoad: number;
  achievedDurationSec: number;
  gapSec: number;
  /** p75 web vitals per browser step; null for protocol-only runs. */
  browser: BrowserStep[] | null;
  /** Funnel steps and integrity counts; null when the journey emits no btb_step_* metrics. */
  journey: JourneySummary | null;
}

/** PROPOSAL: missing telemetry beyond this many seconds puts a measurement-gap caveat on the verdict. */
export const GAP_CAVEAT_SEC = 15;

/** Any oversold seat, double charge or charge without a ticket fails a completed run: the rule is zero of each. */
export function verdictOf(
  outcome: Pick<Outcome, "status" | "abortReason">,
  summary: SummaryNumbers | null,
  thresholds: RunManifest["thresholds"],
  integrity: IntegrityCounts | null = null,
): "pass" | "fail" | null {
  if (outcome.status === "aborted" && outcome.abortReason === "threshold") return "fail";
  if (outcome.status !== "completed" || !summary || !thresholds) return null;
  if (integrity && !integrityClean(integrity)) return "fail";
  return summary.p95Ms <= thresholds.p95Ms && summary.errorRatePct <= thresholds.errorRatePct ? "pass" : "fail";
}

/**
 * `integrity` is null when the target has no adapter or the check didn't answer (E9.3); `saturated` is the
 * reason from `saturationOf`, null when the generators kept up.
 */
export function caveatsOf(outcome: Pick<Outcome, "status">, summary: SummaryNumbers | null, integrity: IntegrityCounts | null = null, saturated: string | null = null): VerdictCaveat[] {
  if (!summary) return outcome.status === "completed" ? ["measurement_gap"] : [];
  const caveats: VerdictCaveat[] = integrity ? [] : ["integrity_not_verified"];
  if (summary.gapSec >= GAP_CAVEAT_SEC) caveats.push("measurement_gap");
  if (saturated) caveats.push("generator_saturated");
  return caveats;
}

/* ---------- Generator saturation (E9.2) ---------- */

/**
 * PROPOSAL: a runner pod using this share of its CPU limit (1 min average) is saturated. Calibration (M5.3,
 * docs/evidence/m5/calibration.md): 800 VUs ran at 172m of 500m; at 1,200 VUs the pod sat at 499m, throughput
 * fell to 90 % and the latency it reported was 8× the target's.
 */
export const SATURATED_CPU_PCT = 90;
/** PROPOSAL: open model; k6 dropping more than this share of iterations means the planned rate wasn't sent. */
export const SATURATED_DROPPED_PCT = 1;

export interface SaturationNumbers {
  /** Busiest runner pod's peak CPU as % of its limit; null when unknown (Docker runners, no cAdvisor). */
  cpuPct: number | null;
  /** Iterations k6 couldn't start (no free VU) as % of all it had to start. */
  droppedPct: number;
}

/** Why the generators couldn't keep up, or null when they did. */
export function saturationOf(s: SaturationNumbers): string | null {
  if (s.cpuPct !== null && s.cpuPct >= SATURATED_CPU_PCT) {
    return `A runner pod used ${s.cpuPct}% of its CPU limit; it was the bottleneck, so the latency it measured is inflated.`;
  }
  if (s.droppedPct > SATURATED_DROPPED_PCT) {
    return `k6 dropped ${s.droppedPct}% of the planned iterations (no free VU), so the planned rate wasn't sent.`;
  }
  return null;
}

/**
 * `namespace` is null when the runners aren't pods. cAdvisor labels pods `<testrun>-<n>-<suffix>` (the
 * initializer and starter pods are left out) and the runner container `k6`.
 */
export function saturationQueries(runId: string, windowSec: number, namespace: string | null, browser: boolean) {
  const w = `${Math.max(Math.ceil(windowSec), PUSH_INTERVAL_SEC)}s`;
  const s = sel(runId);
  const queries: Record<string, string> = {
    dropped: `sum(max_over_time(k6_dropped_iterations_total${s}[${w}]))`,
    iterations: `sum(max_over_time(k6_iterations_total${s}[${w}]))`,
  };
  if (namespace !== null) {
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(namespace)) throw new Error(`Invalid namespace "${namespace}"`);
    const cores = parseQuantity(runnerResources(browser).limits.cpu);
    const cpu = `container_cpu_usage_seconds_total{namespace="${namespace}",pod=~"${testRunName(runId)}-[0-9]+-.*",container="k6"}`;
    queries.cpuPct = `max_over_time(max(rate(${cpu}[1m]))[${w}:${PUSH_INTERVAL_SEC}s]) / ${cores} * 100`;
  }
  return queries;
}

export function saturationNumbers(v: Record<string, number | null>): SaturationNumbers {
  const dropped = v.dropped ?? 0;
  const total = dropped + (v.iterations ?? 0);
  return {
    cpuPct: v.cpuPct == null ? null : Math.round(v.cpuPct),
    droppedPct: total > 0 ? Math.round((dropped / total) * 1000) / 10 : 0,
  };
}

/* ---------- Artifacts (E5.7) ---------- */

/** The k6 summary JSON line (see journeys/src/main.ts handleSummary) and the rest of the pod log. */
export function splitRunnerLog(log: string): { summary: string | null; log: string } {
  const lines = log.split("\n");
  const i = lines.findIndex((l) => l.startsWith(K6_SUMMARY_MARKER));
  if (i < 0) return { summary: null, log };
  const summary = lines[i].slice(K6_SUMMARY_MARKER.length);
  lines.splice(i, 1);
  return { summary, log: lines.join("\n") };
}

/**
 * Fallback for a lost `refused` callback (platform unreachable in setup()): a k6 summary without
 * `setup_data.verified` means setup() never returned, so no scenario ran. Returns the reason, or null.
 */
export function selfCheckRefusal(podLog: string): string | null {
  const { summary, log: rest } = splitRunnerLog(podLog);
  if (!summary) return null;
  try {
    if ((JSON.parse(summary) as { setup_data?: { verified?: boolean } }).setup_data?.verified === true) return null;
  } catch {
    return null;
  }
  return /self-check: ([^"\n]+)/.exec(rest)?.[1].trim() ?? "self-check didn't finish";
}

/* ---------- PromQL (series carry testid=<run id>, see testRunManifest; lease and browser scenarios and the runner's own platform calls are left out) ---------- */

const sel = (runId: string, extra = "") =>
  `{testid="${assertRunId(runId)}",scenario!~"${LEASE_SCENARIO}|${BROWSER_SCENARIO}",name!~"btb-.*"${extra}}`;
/** k6_vus has no scenario label; per runner pod (one series each), one VU is the lease's and BROWSER_VUS_PER_POD are Chromium's. */
const vus = (runId: string, browser: boolean) => {
  const perPod = 1 + (browser ? BROWSER_VUS_PER_POD : 0);
  return `clamp_min(sum(k6_vus${sel(runId)}) - ${perPod} * count(k6_vus${sel(runId)}), 0)`;
};
const FAILED = ',expected_response="false"';

/** Instant queries for one live sample: the last 30 s. */
export function liveQueries(runId: string, browser: boolean) {
  const reqs = `k6_http_reqs_total${sel(runId)}`;
  const duration = `k6_http_req_duration_seconds${sel(runId)}`;
  return {
    vus: vus(runId, browser),
    rps: `sum(rate(${reqs}[30s]))`,
    failedRps: `sum(rate(k6_http_reqs_total${sel(runId, FAILED)}[30s]))`,
    p95: `histogram_quantile(0.95, sum(rate(${duration}[30s]))) * 1000`,
    p99: `histogram_quantile(0.99, sum(rate(${duration}[30s]))) * 1000`,
  };
}

/** k6 pushes every 5 s (K6_PROMETHEUS_RW_PUSH_INTERVAL default). */
export const PUSH_INTERVAL_SEC = 5;

/* ---------- Safety while running (E6.4 target health, E6.5 fail-closed telemetry) ---------- */

export const HEALTH_PROBE_EVERY_SEC = 10;
export const HEALTH_FAILS_TO_ABORT = 3;
/** PROPOSAL: no k6 push for this long (12 push intervals) means telemetry is lost. */
export const TELEMETRY_LOSS_SEC = 60;

/** Unix seconds of the newest push of the run; empty when nothing arrived in the last 5 min. */
export const lastPushQuery = (runId: string) => `max(timestamp(k6_vus${sel(runId)}))`;

/** Seconds without telemetry, counted from `sinceMs` (when watching began) if nothing newer was seen. */
export function telemetrySilenceSec(nowMs: number, sinceMs: number, lastSeenMs: number | null) {
  return Math.max(0, (nowMs - Math.max(sinceMs, lastSeenMs ?? 0)) / 1000);
}

/**
 * End-of-run queries, evaluated at the end time over the whole run. Counters and native histograms are
 * cumulative per runner pod and start at zero, so their last value is the run total.
 */
export function summaryQueries(runId: string, windowSec: number, model: LoadModel, browser: boolean) {
  const w = `${Math.max(Math.ceil(windowSec), PUSH_INTERVAL_SEC)}s`;
  const duration = `k6_http_req_duration_seconds${sel(runId)}`;
  const q = (p: number) => `histogram_quantile(${p}, sum(last_over_time(${duration}[${w}]))) * 1000`;
  return {
    p50: q(0.5),
    p95: q(0.95),
    p99: q(0.99),
    requests: `sum(max_over_time(k6_http_reqs_total${sel(runId)}[${w}]))`,
    failed: `sum(max_over_time(k6_http_reqs_total${sel(runId, FAILED)}[${w}]))`,
    peakRps: `max_over_time(sum(rate(k6_http_reqs_total${sel(runId)}[30s]))[${w}:${PUSH_INTERVAL_SEC}s])`,
    maxVus: `max_over_time(${vus(runId, browser)}[${w}:${PUSH_INTERVAL_SEC}s])`,
    // Open model: achieved load is the arrival rate actually reached.
    peakLoad:
      model === "vus"
        ? `max_over_time(${vus(runId, browser)}[${w}:${PUSH_INTERVAL_SEC}s])`
        : `max_over_time(sum(rate(k6_iterations_total${sel(runId)}[30s]))[${w}:${PUSH_INTERVAL_SEC}s])`,
    // Pushes received from the runner pod that sent the fewest.
    pushes: `min(count_over_time(k6_vus${sel(runId)}[${w}]))`,
  };
}

/**
 * Seconds the run had no telemetry: expected pushes vs received, from the pod with the fewest. Two push
 * intervals of slack cover the first push and the cut-off at the end.
 */
export function gapSeconds(achievedDurationSec: number, pushes: number) {
  return Math.max(0, Math.round(achievedDurationSec - pushes * PUSH_INTERVAL_SEC - 2 * PUSH_INTERVAL_SEC));
}

export const errorRate = (failed: number, total: number) => (total > 0 ? Math.round((failed / total) * 100_000) / 1000 : 0);

/* ---------- Browser steps (E7.8): p75 web vitals per step; the runner tags each page's metrics with the step name ---------- */

const VITALS = {
  lcpMs: "k6_browser_web_vital_lcp_seconds",
  inpMs: "k6_browser_web_vital_inp_seconds",
  cls: "k6_browser_web_vital_cls",
  fcpMs: "k6_browser_web_vital_fcp_seconds",
  ttfbMs: "k6_browser_web_vital_ttfb_seconds",
} as const;
export type Vital = keyof typeof VITALS;

/** Vectors keyed by the `name` label (the step). Times come in seconds, CLS is unitless. */
export function browserQueries(runId: string, windowSec: number): Record<Vital, string> {
  const w = `${Math.max(Math.ceil(windowSec), PUSH_INTERVAL_SEC)}s`;
  const s = `{testid="${assertRunId(runId)}",scenario="${BROWSER_SCENARIO}"}`;
  const p75 = (metric: string) => `histogram_quantile(0.75, sum by (name) (last_over_time(${metric}${s}[${w}])))`;
  return Object.fromEntries(Object.entries(VITALS).map(([k, m]) => [k, k === "cls" ? p75(m) : `${p75(m)} * 1000`])) as Record<Vital, string>;
}

/** One row per step that reported any vital, in first-seen order; null when none did. */
export function browserSteps(values: Record<Vital, Record<string, number>>): BrowserStep[] | null {
  const steps = [...new Set(Object.values(values).flatMap((v) => Object.keys(v)))];
  if (!steps.length) return null;
  const ms = (n: number | undefined) => (n === undefined ? null : Math.round(n));
  return steps.map((step) => ({
    step,
    lcpMs: ms(values.lcpMs[step]),
    inpMs: ms(values.inpMs[step]),
    cls: values.cls[step] === undefined ? null : Math.round(values.cls[step] * 1000) / 1000,
    fcpMs: ms(values.fcpMs[step]),
    ttfbMs: ms(values.ttfbMs[step]),
  }));
}

/* ---------- Journey funnel (E7.4) and integrity counters (E7.7): custom btb_* metrics from the journey ---------- */

/** Vectors keyed by the `step` (or `item`) tag, plus one scalar. Counters are cumulative, so max = run total. */
export function journeyQueries(runId: string, windowSec: number) {
  const w = `${Math.max(Math.ceil(windowSec), PUSH_INTERVAL_SEC)}s`;
  const total = (metric: string, by: string) => `sum by (${by}) (max_over_time(${metric}${sel(runId)}[${w}]))`;
  const p95 = (metric: string, by = "") => `histogram_quantile(0.95, sum${by ? ` by (${by})` : ""} (last_over_time(${metric}${sel(runId)}[${w}]))) * 1000`;
  return {
    reached: total("k6_btb_step_reached_total", "step"),
    completed: total("k6_btb_step_completed_total", "step"),
    stepP95: p95("k6_btb_step_duration_seconds", "step"),
    paymentToConfirmation: p95("k6_btb_payment_to_confirmation_seconds"),
    integrity: total("k6_btb_integrity_total", "item"),
  };
}

const INTEGRITY_ITEMS: IntegrityItem[] = ["order", "seat", "ticket", "charge"];

/**
 * Null when the journey reported no steps. Steps come back in funnel order as far as the numbers tell
 * (most reached first); ties keep Prometheus order, so the UI re-sorts by the journey's declared steps.
 */
export function journeySummary(v: {
  reached: Record<string, number>;
  completed: Record<string, number>;
  stepP95: Record<string, number>;
  paymentToConfirmation: number | null;
  integrity: Record<string, number>;
}): JourneySummary | null {
  const names = Object.keys(v.reached);
  if (!names.length) return null;
  const steps = names
    .map((step) => ({
      step,
      reached: Math.round(v.reached[step]),
      completed: Math.round(v.completed[step] ?? 0),
      p95Ms: v.stepP95[step] === undefined ? null : Math.round(v.stepP95[step]),
    }))
    .sort((a, b) => b.reached - a.reached || b.completed - a.completed);
  const counted = INTEGRITY_ITEMS.some((k) => k in v.integrity);
  return {
    steps,
    paymentToConfirmationP95Ms: v.paymentToConfirmation === null ? null : Math.round(v.paymentToConfirmation),
    counts: counted ? (Object.fromEntries(INTEGRITY_ITEMS.map((k) => [k, Math.round(v.integrity[k] ?? 0)])) as Record<IntegrityItem, number>) : null,
  };
}

/* ---------- Executors (E5.1, E5.5): pure parts of the Kubernetes and Docker executors ---------- */

/** k6-operator stage + runner pods -> executor status. Null = no TestRun. */
export function kubeStatus(tr: { stage: string | null; parallelism?: number } | null, pods: RunnerExit[] = []): ExecutionStatus | null {
  if (!tr) return null;
  if (tr.stage === "error") return { stage: "failed", runners: [], detail: "k6-operator reported an error for the TestRun." };
  const parallelism = tr.parallelism ?? pods.length;
  if (tr.stage === "finished") {
    // k6-operator says finished as soon as a pod is gone; a deleted pod leaves no exit code to wait for.
    if (pods.length < parallelism) return { stage: "failed", runners: [], detail: runnerDied(pods, parallelism) ?? "" };
    // Finished can be reported a moment before the last pod has its exit code.
    return pods.length && pods.every((p) => p.exitCode !== null) ? { stage: "finished", runners: pods } : { stage: "running", runners: [] };
  }
  if (tr.stage === "started") {
    const died = runnerDied(pods, parallelism);
    return died ? { stage: "failed", runners: [], detail: died } : { stage: "running", runners: [] };
  }
  if (tr.stage === "stopped") return { stage: "running", runners: [] };
  return { stage: "pending", runners: [], detail: `stage: ${tr.stage ?? "none"}` };
}

/** Exit codes a runner ends a run with by itself: done, thresholds crossed, self-check refusal or lost lease. */
const RUNNER_OWN_EXITS = new Set([0, K6_THRESHOLDS_FAILED_EXIT, K6_SCRIPT_ABORTED_EXIT]);

/**
 * While the TestRun is started: a runner pod that is gone (deleted, evicted; its Job doesn't restart it) or was
 * killed (OOM, signal) leaves the rest sending only part of the load. Null while all are fine.
 */
export function runnerDied(pods: RunnerExit[], parallelism: number): string | null {
  const killed = pods.find((p) => p.exitCode !== null && !RUNNER_OWN_EXITS.has(p.exitCode));
  if (killed) return `Runner pod ${killed.name} died (exit ${killed.exitCode}${killed.exitCode === 137 ? ", killed: out of memory or a signal" : ""}) before the run ended; any other runners were stopped.`;
  if (pods.length < parallelism) {
    const gone = parallelism - pods.length;
    return `${gone} of ${parallelism} runner pod${parallelism === 1 ? "" : "s"} disappeared (deleted or evicted) before the run ended; any other runners were stopped.`;
  }
  return null;
}

export const DOCKER_SCOPE_LABEL = "btb.io/scope";
/** Hostname of runner `i` (1-based); the container is `<hostname>-c`, so callbacks (named by hostname) match it. */
export const dockerHostname = (runId: string, i: number) => `${testRunName(runId)}-r${i}`;

/** `docker run` arguments for one runner container (no shell: passed to execFile as-is). */
export function dockerRunArgs(spec: ExecutionSpec, network: string, i: number): string[] {
  const host = dockerHostname(spec.runId, i);
  const limits = runnerResources(!!spec.config.browser).limits;
  return [
    "run",
    "--detach",
    "--pull=never",
    `--name=${host}-c`,
    `--hostname=${host}`,
    `--label=${RUN_ID_LABEL}=${spec.runId}`,
    `--label=${DOCKER_SCOPE_LABEL}=${spec.scope}`,
    `--network=${network}`,
    `--cpus=${parseQuantity(limits.cpu)}`,
    `--memory=${Math.round(parseQuantity(limits.memory))}b`,
    "--env",
    `${RUNNER_CONFIG_ENV}=${JSON.stringify(spec.config)}`,
    "--env",
    `K6_PROMETHEUS_RW_SERVER_URL=${spec.remoteWriteUrl}`,
    "--env",
    "K6_FEATURES=native-histograms",
    "--env",
    `GOMEMLIMIT=${goMemLimit(!!spec.config.browser)}`,
    spec.image,
    "run",
    `--tag=testid=${spec.runId}`,
    "--out=experimental-prometheus-rw",
    RUNNER_SCRIPT_PATH,
  ];
}

/** One line of `docker ps -a --format '{{json .}}'`, the fields used. */
export interface DockerPsRow {
  Names: string;
  State: string;
  Status: string;
}

/** Runner containers -> executor status. Null = none. */
export function dockerStatus(rows: DockerPsRow[]): ExecutionStatus | null {
  if (!rows.length) return null;
  if (rows.some((r) => r.State === "dead")) return { stage: "failed", runners: [], detail: "A runner container is dead." };
  if (rows.some((r) => r.State === "running" || r.State === "restarting" || r.State === "paused")) return { stage: "running", runners: [] };
  if (rows.some((r) => r.State === "created")) return { stage: "pending", runners: [], detail: "containers created" };
  const runners = rows.map((r) => ({ name: r.Names, exitCode: Number(/Exited \((\d+)\)/.exec(r.Status)?.[1] ?? NaN) })).map((r) => ({ ...r, exitCode: Number.isNaN(r.exitCode) ? null : r.exitCode }));
  return { stage: "finished", runners: runners.sort((a, b) => a.name.localeCompare(b.name)) };
}
