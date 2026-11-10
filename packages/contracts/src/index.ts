/*
 * Shapes shared by the web app, the worker and the runner image (PRD E0.1 `packages/contracts`).
 * Types and plain constants only, no runtime dependencies: the browser bundle can import this too.
 */

/* ---------- Run lifecycle (PRD E3) ---------- */

export const RUN_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "queued",
  "starting",
  "running",
  "stopping",
  "completed",
  "failed",
  "aborted",
  "rejected",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Statuses that hold the target (the database's one-active-run-per-target index uses the same list). */
export const ACTIVE_STATUSES = ["starting", "running", "stopping"] as const satisfies readonly RunStatus[];
/** Accepted for execution and not finished yet. */
export const IN_FLIGHT_STATUSES: readonly RunStatus[] = ["queued", ...ACTIVE_STATUSES];
export const TERMINAL_STATUSES: readonly RunStatus[] = ["completed", "failed", "aborted", "rejected"];

export type Role = "viewer" | "engineer" | "approver" | "admin";
export type Environment = "staging" | "prod-like";
export type Preset = "smoke" | "baseline" | "peak" | "spike" | "soak" | "stress";
/** Closed model = virtual users; open model = arrival rate (PRD story 2). */
export type LoadModel = "vus" | "rps";
/** Browser-step network presets (PRD story 6). */
export type NetworkProfile = "stadium-4g" | "wifi-baseline";
/** Structured abort reasons (PRD story 22). */
export type AbortReason = "emergency_stop" | "lease_expired" | "threshold" | "target_health" | "telemetry_lost" | "policy_breach" | "kubernetes_failure";
export type VerdictCaveat = "measurement_gap" | "generator_saturated" | "integrity_not_verified";

/* ---------- Journey catalog, synced from the runner image (E2.2) ---------- */

export type ParamValue = string | number | boolean;

export interface JourneyParam {
  name: string;
  type: "string" | "number" | "boolean";
  default: ParamValue;
  description: string;
  min?: number;
  max?: number;
  unit?: string;
}

export interface JourneyMeta {
  id: string;
  title: string;
  description: string;
  /** Journey code version inside the runner image. */
  version: string;
  /** Has k6 browser steps (takes a network profile). */
  browser: boolean;
  /** Named groups; each gets its own latency series. */
  steps: string[];
  params: JourneyParam[];
  /** Default product budgets (PRD). */
  budgets: { metric: string; budget: string }[];
}

export const RUNNER_IMAGE_NAME = "btb-runner";

/**
 * What a runner image does on its own (decided 2026-11-08). 1 = lease only; 2 = self-check and signed callbacks (E5.3).
 * Policy refuses versions whose image is below this; a new version on the current image fixes it.
 */
export const RUNNER_PROTOCOL = 2;

/** What the runner image build writes to catalog.json; `catalog:sync` loads it into Postgres. */
export interface RunnerCatalog {
  /** No protocol = 1 (built before it was recorded). */
  image: { name: string; tag: string; protocol?: number };
  builtAt: string;
  journeys: JourneyMeta[];
}

/* ---------- Project catalog: what a project can run (E2.1–E2.3). Plain data, so forms run policy too. ---------- */

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface Target {
  /** The target's name, unique per project (what manifests and URLs use). */
  id: string;
  name: string;
  environment: Environment;
  /** Per-target reference peak from the Engineering manager (D12). Presets scale from it. */
  referencePeak: Record<LoadModel, number>;
  /** Allowlist (E2.1): anything outside is rejected by policy and blocked by NetworkPolicy. */
  hosts: string[];
  paths: string[];
  methods: HttpMethod[];
  redirects: string[];
  /** Probed every 10 s during a run; 3 failures abort it (story 19). */
  healthPath: string;
  /** Read-only integrity endpoint on the first host (E9.3); null = runs carry "integrity not verified". */
  integrityPath: string | null;
}

/** abortOnFail thresholds every run must carry (E6.3): p95 latency and error rate. */
export interface Thresholds {
  p95Ms: number;
  errorRatePct: number;
}

export interface ScenarioVersion {
  version: number;
  model: LoadModel;
  /** From the journey: browser steps take a network profile (Stadium 4G / Wi-Fi baseline). */
  browser: boolean;
  /** Null = none defined; policy rejects a run without thresholds (E3.3). */
  thresholds: Thresholds | null;
  /** Runner image the version was saved against (recorded on every run). */
  imageVersion: string;
  /** That image's RUNNER_PROTOCOL; lower = policy refuses to run the version. */
  runnerProtocol: number;
  params: Record<string, ParamValue>;
  createdBy: string;
  createdAt: string;
  note?: string;
}

export interface Scenario {
  name: string;
  journey: string;
  /** Newest first. Versions are immutable (E2.3). */
  versions: ScenarioVersion[];
}

/** Per-environment limits (admin-edited, environments table). */
export interface Ceiling {
  vus: number;
  rps: number;
  durationSec: number;
  /** Load added per minute while ramping. */
  rampPerMin: number;
}

/** The runner image the catalog was last synced from. */
export interface RunnerImage {
  name: string;
  tag: string;
  protocol: number;
  syncedAt: string;
}

export interface ProjectCatalog {
  targets: Target[];
  scenarios: Scenario[];
  /** Per-environment ceilings, so policy runs the same in the form and on the server. */
  ceilings: Record<Environment, Ceiling>;
  journeys: JourneyMeta[];
  /** Null until the first `catalog:sync`. */
  image: RunnerImage | null;
}

/** One rule broken, as returned by the policy engine on HTTP 422 (E3.3). `field` names the form field. */
export interface PolicyViolation {
  field: string;
  rule: string;
  message: string;
}

/* ---------- Run data ---------- */

/** p75 web vitals of one browser step; null when the run didn't report it (e.g. INP without an interaction). */
export interface BrowserStep {
  step: string;
  lcpMs: number | null;
  inpMs: number | null;
  cls: number | null;
  fcpMs: number | null;
  ttfbMs: number | null;
}

/** One funnel step of a protocol journey (E7.4), from the btb_step_* metrics. */
export interface JourneyStepResult {
  step: string;
  reached: number;
  completed: number;
  /** p95 of the whole step (retries and polling included); null when no duration was recorded. */
  p95Ms: number | null;
}

/** What a journey counted (E7.7, btb_integrity by item): its own view, for the integrity adapter to check. */
export type IntegrityItem = "order" | "seat" | "ticket" | "charge";

export interface JourneySummary {
  steps: JourneyStepResult[];
  paymentToConfirmationP95Ms: number | null;
  /** Null when the journey emits no integrity counters. */
  counts: Record<IntegrityItem, number> | null;
}

/** Run timeline colour; stored in audit_logs.data.tone. */
export type Tone = "neutral" | "success" | "warning" | "danger" | "info";

/** The 7 preflight checks (PRD E3.4). */
export type PreflightKey = "approval" | "target" | "window" | "test_data" | "target_health" | "monitoring" | "runner_capacity";
export type PreflightState = "pass" | "fail" | "checking" | "pending";
export type PreflightResults = Partial<Record<PreflightKey, { state: PreflightState; reason?: string }>>;

/** The immutable plan approvals are bound to (E3.2). Written by the web app, executed by the worker. */
export interface RunManifest {
  projectId: string;
  scenario: { name: string; journey: string; version: number; imageVersion: string };
  params: Record<string, ParamValue>;
  environment: Environment;
  /** Target name (unique per project). */
  target: string;
  preset: Preset;
  load: { model: LoadModel; target: number; durationSec: number; rampSec: number };
  network: NetworkProfile | null;
  thresholds: { p95Ms: number; errorRatePct: number; abortOnFail: true } | null;
  releaseId: string | null;
}

/*
 * Canonical form the manifest hash is taken over (E3.2): keys sorted at every level, no whitespace, so Postgres
 * jsonb reordering doesn't change it. Lives here, not in core, because the runner (k6) recomputes the hash too.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const out = JSON.stringify(value);
    if (out === undefined) throw new Error(`Not JSON: ${typeof value}`);
    return out;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/* ---------- Live metrics (E8.2): worker -> Redis -> SSE ---------- */

export const LIVE_INTERVAL_SEC = 5;

export interface LiveSample {
  at: string;
  elapsedSec: number;
  vus: number;
  rps: number;
  p95Ms: number;
  p99Ms: number;
  errorRatePct: number;
}

export interface LivePlan {
  model: LoadModel;
  load: number;
  rampSec: number;
  durationSec: number;
}

/**
 * Redis keys. One live loop per run writes them, whatever the number of viewers (N1); SSE handlers only read.
 * PROPOSAL: samples are kept for 30 days so the HTML report can draw the charts after the run.
 */
export const redisKeys = {
  /** List of LiveSample JSON, oldest first. */
  samples: (runId: string) => `btb:run:${runId}:samples`,
  /** Set by every worker tick; the lease endpoint stops runners when it's gone (nobody would end the run). */
  workerHeartbeat: "btb:worker:heartbeat",
};
export const SAMPLES_TTL_SEC = 30 * 24 * 3600;
/** PROPOSAL: six missed 5 s ticks. */
export const WORKER_HEARTBEAT_TTL_SEC = 30;

/* ---------- Runner (worker -> TestRun -> k6-lib) ---------- */

/** Everything the runner needs, passed as one JSON env var so the worker and k6-lib can't drift apart. */
export interface RunnerConfig {
  runId: string;
  /** The approved hash the worker built this config from; the runner checks it against the platform (E5.3). */
  manifestHash: string;
  /** RUNNER_MANIFEST_PATH and RUNNER_CALLBACK_PATH on the platform. */
  manifestUrl: string;
  callbackUrl: string;
  journey: string;
  params: Record<string, ParamValue>;
  model: LoadModel;
  /** Total load: VUs or iterations/s. k6-operator splits it across runner pods (execution segments). */
  load: number;
  /** Whole profile length, ramp included. */
  durationSec: number;
  rampSec: number;
  thresholds: { p95Ms: number; errorRatePct: number } | null;
  /** Runner pods (TestRun parallelism); the lease scenario runs one VU in each. */
  runners: number;
  lease: RunnerLease;
  /** scheme://host[:port], no path. Its host must be in allowedHosts. */
  targetUrl: string;
  allowedHosts: string[];
  /** Path prefixes (segment-aware): "/orders" allows "/orders" and "/orders/1", not "/ordersx". */
  allowedPaths: string[];
  allowedMethods: string[];
  /** Browser steps (k6 browser, own scenario) next to the protocol load; null for protocol-only journeys. */
  browser: { vus: number; network: NetworkProfile; artifactsUrl: string } | null;
  /**
   * Test-data identities (E2.6): only the Kubernetes Secret's name and the pool size. The values are mounted
   * into the runner pods at RUNNER_TEST_DATA_DIR and never pass through the platform. Null = no pool.
   */
  testData: { secret: string; total: number } | null;
}

/** Where runner pods find the target's test-data Secret, mounted read-only. */
export const RUNNER_TEST_DATA_DIR = "/var/run/btb/test-data";
/** The Secret key: a JSON array of identities. */
export const TEST_DATA_KEY = "identities.json";
/** The Secret an ExternalSecret fills from the pool's secret path, in every runner namespace. */
export const testDataSecretName = (target: string) => `btb-test-data-${target}`.slice(0, 253);

export const RUNNER_CONFIG_ENV = "BTB_RUN_CONFIG";

/** PROPOSAL: plain http inside the cluster (`*.svc` / `*.svc.cluster.local`), https everywhere else. */
export function targetUrl(host: string) {
  const name = host.replace(/:\d+$/, "");
  return `${/\.svc(\.cluster\.local)?$/.test(name) || isLocalHost(host) ? "http" : "https"}://${host}`;
}

/** Loopback hosts: this machine only. The Docker executor (E5.5) loads nothing else; they're plain http. */
export function isLocalHost(hostWithPort: string): boolean {
  const host = hostWithPort.replace(/:\d+$/, "").replace(/^\[(.*)\]$/, "$1").toLowerCase();
  return host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127(\.\d{1,3}){3}$/.test(host);
}
/** Where the runner image keeps the bundled script (TestRun spec.script.localFile). */
export const RUNNER_SCRIPT_PATH = "/home/k6/btb/main.js";
/** k6 exits with this code when thresholds failed (including abortOnFail). */
export const K6_THRESHOLDS_FAILED_EXIT = 99;
/** Prefix of the single stdout line where the runner prints k6's end-of-test summary JSON (collected as an artifact). */
export const K6_SUMMARY_MARKER = "BTB_K6_SUMMARY ";
/** k6's exit code after exec.test.abort(); only the lease scenario calls it. */
export const K6_SCRIPT_ABORTED_EXIT = 108;

/*
 * Runner lease (E6.1). Each runner pod checks in with the platform every `everySec`; it aborts itself on
 * "stop" or when no check-in succeeded for `graceSec`, so a lost control plane can't leave load running.
 */
export const LEASE_SCENARIO = "btb-lease";
/** The k6 browser scenario; its VUs are page visits, not protocol load. */
export const BROWSER_SCENARIO = "btb-browser";
export const LEASE_PATH = "/api/runner/lease";

export interface RunnerLease {
  url: string;
  /** `<expiry unix s>.<HMAC of run id + expiry>` (core/lease); sent as a Bearer token on every runner call. */
  token: string;
  everySec: number;
  graceSec: number;
}

export interface LeaseRequest {
  runId: string;
}
export type LeaseReply = { action: "continue" } | { action: "stop"; reason: string };

/*
 * Runner self-check (E5.3): before any load, the runner fetches the manifest with its token, recomputes the
 * hash, checks the approvals and that its own config is that manifest. Any problem: the test aborts in setup().
 */
export const RUNNER_MANIFEST_PATH = "/api/runner/manifest";

export interface RunnerManifestReply {
  manifest: RunManifest;
  /** The hash approvals were given for. */
  manifestHash: string;
  /** Enough approvals for that hash (same rule as the worker). */
  approved: boolean;
  /** The target's allowlist as stored now. */
  allowlist: { hosts: string[]; paths: string[]; methods: string[] };
}

/*
 * Runner callbacks (E5.4, E6.6): each pod reports to the platform, signed, independent of logs. They land in
 * audit_logs (data.callback = event). Body signature: hex HMAC-SHA256 of the raw body keyed with the token.
 */
export const RUNNER_CALLBACK_PATH = "/api/runner/callback";
export const RUNNER_SIGNATURE_HEADER = "x-btb-signature";
/** Caps so a runner can't flood the timeline (decided 2026-11-08). */
export const RUNNER_CALLBACK_MAX_BYTES = 4096;
export const RUNNER_CALLBACKS_PER_RUN = 200;

/** verified/refused: the self-check in setup(). stopped: the lease aborted the test. finished: end of the pod's k6. */
export const RUNNER_EVENTS = ["verified", "refused", "stopped", "finished"] as const;
export type RunnerEvent = (typeof RUNNER_EVENTS)[number];

export interface RunnerCallback {
  runId: string;
  /** Pod hostname (`<testrun>-<index>`). */
  pod: string;
  event: RunnerEvent;
  reason?: string;
  /** finished only. */
  thresholdsOk?: boolean;
  iterations?: number;
}

/*
 * Browser evidence (E5.7): runner pods upload screenshots and browser errors while the run is live, with the
 * lease token: `POST <RUNNER_ARTIFACTS_PATH>?runId=<id>&name=<file>`, raw body. Only these names are accepted.
 */
export const RUNNER_ARTIFACTS_PATH = "/api/runner/artifacts";
/** PROPOSAL: caps per file and per run, so a runner can't fill the bucket. */
export const RUNNER_ARTIFACT_MAX_BYTES = 1024 * 1024;
export const RUNNER_ARTIFACTS_PER_RUN = 60;

const SHOT_RE = /^screenshot-([a-z0-9-]{1,48})-vu(\d{1,6})-(ok|fail(\d{1,2}))\.png$/;
const ERRORS_RE = /^browser-errors-vu(\d{1,6})\.json$/;

/** Content type and download label of an upload name; null when the name isn't one runners may upload. */
export function runnerArtifactOf(name: string): { label: string; contentType: string } | null {
  const shot = SHOT_RE.exec(name);
  if (shot) {
    const [, step, vu, , fail] = shot;
    const label = fail ? `Screenshot, ${step} failed (browser VU ${vu}, #${fail})` : `Screenshot, ${step} (browser VU ${vu})`;
    return { label, contentType: "image/png" };
  }
  const errors = ERRORS_RE.exec(name);
  if (errors) return { label: `Browser errors, VU ${errors[1]}`, contentType: "application/json" };
  return null;
}

export interface BrowserError {
  step: string;
  /** console: console.error in the page. page: uncaught exception or rejection. step: the step itself threw. */
  kind: "console" | "page" | "step";
  text: string;
  count: number;
  firstAt: string;
  lastAt: string;
}

/** browser-errors-vu<n>.json: distinct errors of one browser VU, rewritten as they come in. */
export interface BrowserErrorsFile {
  runId: string;
  vu: number;
  updatedAt: string;
  errors: BrowserError[];
  /** Occurrences of distinct errors beyond the cap, not listed. */
  dropped: number;
}

/* ---------- Queue (BullMQ) ---------- */

export const RUNS_QUEUE = "btb-runs";

export type RunJob =
  /** Try to start queued runs (capacity: 1 per target, 2 per namespace). Idempotent. */
  | { name: "dispatch"; data: { reason: string } }
  /** Emergency stop: delete the TestRun. */
  | { name: "stop"; data: { runId: string } };
