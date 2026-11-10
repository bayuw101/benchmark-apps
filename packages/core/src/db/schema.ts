import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { RUN_STATUSES, type BrowserStep, type JourneySummary, type JourneyParam, type ParamValue, type PreflightResults } from "@btb/contracts";

/*
 * Platform database (PRD "Data model"): projects, environments, targets, journeys, scenarios + versions,
 * runs (immutable manifest + hash), approvals (bound to the hash), run summaries, baselines, artifacts,
 * audit log, test-data pools, roles. One schema for the web app and the worker.
 *
 * What the schema can't say lives in drizzle/0001_guards.sql: audit_logs is partitioned by month and
 * append-only (trigger + grants), run ids come from next_run_id(), and the two environments are seeded.
 * Never `drizzle-kit push`: it would try to rebuild audit_logs as a plain table. Always generate + migrate.
 */

export const roleEnum = pgEnum("role", ["viewer", "engineer", "approver", "admin"]);
export const loadModelEnum = pgEnum("load_model", ["vus", "rps"]);
export const presetEnum = pgEnum("preset", ["smoke", "baseline", "peak", "spike", "soak", "stress"]);
export const networkProfileEnum = pgEnum("network_profile", ["stadium-4g", "wifi-baseline"]);
export const runStatusEnum = pgEnum("run_status", RUN_STATUSES);
export const abortReasonEnum = pgEnum("abort_reason", ["emergency_stop", "lease_expired", "threshold", "target_health", "telemetry_lost", "policy_breach", "kubernetes_failure"]);
export const verdictEnum = pgEnum("verdict", ["pass", "fail"]);
export const caveatEnum = pgEnum("verdict_caveat", ["measurement_gap", "generator_saturated", "integrity_not_verified"]);
export const decisionEnum = pgEnum("approval_decision", ["approved", "rejected"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });

/* ---------- People (E1.3): roles live here, not in Entra groups. null role = signed in, no access. ---------- */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Entra object id once Auth.js is wired; null for people added in Admin before their first sign-in. */
    entraOid: text("entra_oid"),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: roleEnum("role"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_idx").on(sql`lower(${t.email})`), uniqueIndex("users_entra_oid_idx").on(t.entraOid)],
);

/* ---------- Catalog (E2) ---------- */

export const projects = pgTable("projects", {
  /** Slug, e.g. "arbiter-ticketing"; also the project cookie value. */
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Two rows (staging, prod-like), seeded by the migration. Ceilings are admin-edited; approval rules stay in policy code. */
export const environments = pgTable("environments", {
  id: text("id").primaryKey(),
  namespace: text("namespace").notNull().unique(),
  maxVus: integer("max_vus").notNull(),
  maxRps: integer("max_rps").notNull(),
  maxDurationSec: integer("max_duration_sec").notNull(),
  maxRampPerMin: integer("max_ramp_per_min").notNull(),
  updatedAt: updatedAt(),
});

export const targets = pgTable(
  "targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    name: text("name").notNull(),
    environment: text("environment")
      .notNull()
      .references(() => environments.id),
    /** Reference peak (D12); presets scale from it. */
    peakVus: integer("peak_vus").notNull(),
    peakRps: integer("peak_rps").notNull(),
    /** Allowlist (E2.1): policy rejects and NetworkPolicy blocks anything else. */
    hosts: text("hosts").array().notNull(),
    paths: text("paths").array().notNull(),
    methods: text("methods").array().notNull(),
    redirects: text("redirects").array().notNull().default(sql`'{}'`),
    healthPath: text("health_path").notNull().default("/health"),
    /** Read-only integrity endpoint on the first host (E9.3); null = integrity can't be verified for this target. */
    integrityPath: text("integrity_path"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("targets_project_name_idx").on(t.projectId, t.name)],
);

/** Runner images the catalog was synced from; recorded on every scenario version and run. */
export const runnerImages = pgTable("runner_images", {
  tag: text("tag").primaryKey(),
  digest: text("digest"),
  /** RUNNER_PROTOCOL the image speaks; images synced before it was recorded are 1. */
  protocol: integer("protocol").notNull().default(1),
  syncedAt: ts("synced_at").notNull().defaultNow(),
});

/** Journey catalog, synced from the runner image (E2.2). Read-only in the UI; one row per journey, last sync wins. */
export const journeys = pgTable("journeys", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  version: text("version").notNull(),
  browser: boolean("browser").notNull(),
  steps: text("steps").array().notNull(),
  params: jsonb("params").$type<JourneyParam[]>().notNull(),
  budgets: jsonb("budgets").$type<{ metric: string; budget: string }[]>().notNull(),
  imageTag: text("image_tag")
    .notNull()
    .references(() => runnerImages.tag),
  syncedAt: ts("synced_at").notNull().defaultNow(),
});

export const scenarios = pgTable(
  "scenarios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    name: text("name").notNull(),
    journeyId: text("journey_id")
      .notNull()
      .references(() => journeys.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("scenarios_project_name_idx").on(t.projectId, t.name)],
);

/** Immutable (E2.3): a trigger rejects UPDATE/DELETE. Any change is a new version. */
export const scenarioVersions = pgTable(
  "scenario_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scenarioId: uuid("scenario_id")
      .notNull()
      .references(() => scenarios.id),
    version: integer("version").notNull(),
    model: loadModelEnum("model").notNull(),
    /** Copied from the journey at save time, so a resync can't change what a version meant. */
    browser: boolean("browser").notNull(),
    /** Both null = no thresholds; policy refuses to run such a version (E3.3). */
    p95Ms: integer("p95_ms"),
    errorRatePct: numeric("error_rate_pct", { precision: 5, scale: 2, mode: "number" }),
    imageTag: text("image_tag")
      .notNull()
      .references(() => runnerImages.tag),
    params: jsonb("params").$type<Record<string, ParamValue>>().notNull(),
    note: text("note"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("scenario_versions_scenario_version_idx").on(t.scenarioId, t.version),
    check("scenario_versions_thresholds_check", sql`(${t.p95Ms} IS NULL) = (${t.errorRatePct} IS NULL)`),
  ],
);

/* ---------- Runs (E3) ---------- */

export const runs = pgTable(
  "runs",
  {
    /** "RUN-0421", from next_run_id() (0001_guards.sql). */
    id: text("id").primaryKey().default(sql`next_run_id()`),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    scenarioVersionId: uuid("scenario_version_id")
      .notNull()
      .references(() => scenarioVersions.id),
    targetId: uuid("target_id")
      .notNull()
      .references(() => targets.id),
    environment: text("environment")
      .notNull()
      .references(() => environments.id),
    preset: presetEnum("preset").notNull(),
    network: networkProfileEnum("network"),
    releaseId: text("release_id"),
    status: runStatusEnum("status").notNull().default("draft"),
    /** The manifest approvals are bound to (E3.2); an edit replaces it and the hash (open question 3). */
    manifest: jsonb("manifest").$type<Record<string, unknown>>().notNull(),
    manifestHash: text("manifest_hash").notNull(),
    durationSec: integer("duration_sec").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    submittedAt: ts("submitted_at"),
    startRequestedAt: ts("start_requested_at"),
    startedAt: ts("started_at"),
    endedAt: ts("ended_at"),
    /** Last preflight (E3.4); null until someone presses Start. */
    preflight: jsonb("preflight").$type<PreflightResults>(),
    /** The run this one waits for (1 active run per target, E3.5). */
    queuedBehind: text("queued_behind"),
    abortReason: abortReasonEnum("abort_reason"),
    verdict: verdictEnum("verdict"),
    caveats: caveatEnum("caveats").array().notNull().default(sql`'{}'`),
    /** BTB_VERSION of the web app that created the run and of the worker that started it (E0.1); null on older runs. */
    webVersion: text("web_version"),
    workerVersion: text("worker_version"),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("runs_project_created_idx").on(t.projectId, t.createdAt.desc()),
    index("runs_status_idx").on(t.status),
    // The concurrency rule itself: one starting/running/stopping run per target, whatever the app does.
    uniqueIndex("runs_one_active_per_target_idx").on(t.targetId).where(sql`${t.status} IN ('starting', 'running', 'stopping')`),
    check("runs_manifest_hash_check", sql`${t.manifestHash} ~ '^[0-9a-f]{64}$'`),
    check("runs_ended_after_started_check", sql`${t.endedAt} IS NULL OR ${t.startedAt} IS NULL OR ${t.endedAt} >= ${t.startedAt}`),
  ],
);

/* ---------- Approvals (E4): each one names the hash it was given for. ---------- */

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id),
    /** Null = auto-approved by policy; then `rule` says which one. */
    userId: uuid("user_id").references(() => users.id),
    rule: text("rule"),
    manifestHash: text("manifest_hash").notNull(),
    decision: decisionEnum("decision").notNull(),
    /** Required on a rejection (5–300 chars, checked by the app). */
    note: text("note"),
    createdAt: createdAt(),
    /** 24 h after `createdAt` (N4); null for rejections. */
    expiresAt: ts("expires_at"),
  },
  (t) => [
    index("approvals_run_idx").on(t.runId),
    // One live approval per person per hash; a re-approval after expiry updates expires_at.
    uniqueIndex("approvals_run_user_hash_idx").on(t.runId, t.userId, t.manifestHash).where(sql`${t.decision} = 'approved'`),
    check("approvals_by_check", sql`(${t.userId} IS NULL) <> (${t.rule} IS NULL)`),
  ],
);

/* ---------- Results (E9) ---------- */

/** End-of-run numbers (E9.1); survive metrics retention. Thresholds and planned load are in the run's manifest. */
export const runSummaries = pgTable(
  "run_summaries",
  {
    runId: text("run_id")
      .primaryKey()
      .references(() => runs.id),
    p50Ms: integer("p50_ms").notNull(),
    p95Ms: integer("p95_ms").notNull(),
    p99Ms: integer("p99_ms").notNull(),
    errorRatePct: numeric("error_rate_pct", { precision: 6, scale: 3, mode: "number" }).notNull(),
    peakRps: integer("peak_rps").notNull(),
    maxVus: integer("max_vus").notNull(),
    achievedLoad: integer("achieved_load").notNull(),
    achievedDurationSec: integer("achieved_duration_sec").notNull(),
    /** Seconds of missing telemetry (measurement-gap caveat). */
    gapSec: integer("gap_sec").notNull().default(0),
    /** Per-step web vitals for browser scenarios (E7.8); null otherwise. */
    browser: jsonb("browser").$type<BrowserStep[]>(),
    /** Funnel steps, payment→confirmation and integrity counts of protocol journeys that emit them (E7.4, E7.7). */
    journey: jsonb("journey").$type<JourneySummary>(),
    /** Integrity counts (E9.3); all null = integrity not verified. */
    oversoldSeats: integer("oversold_seats"),
    doubleCharges: integer("double_charges"),
    chargedNoTicket: integer("charged_no_ticket"),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "run_summaries_integrity_check",
      sql`(${t.oversoldSeats} IS NULL) = (${t.doubleCharges} IS NULL) AND (${t.oversoldSeats} IS NULL) = (${t.chargedNoTicket} IS NULL)`,
    ),
  ],
);

/** One pinned run per target + scenario + preset (E9.4). The target fixes the project. */
export const baselines = pgTable(
  "baselines",
  {
    targetId: uuid("target_id")
      .notNull()
      .references(() => targets.id),
    scenarioId: uuid("scenario_id")
      .notNull()
      .references(() => scenarios.id),
    preset: presetEnum("preset").notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id),
    setBy: uuid("set_by")
      .notNull()
      .references(() => users.id),
    setAt: ts("set_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.targetId, t.scenarioId, t.preset] })],
);

/** S3 keys for k6 summary, browser errors, screenshots and the HTML report (E5.7, D5: 90-day retention). */
export const runArtifacts = pgTable(
  "run_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id),
    /** File name, e.g. "summary.json", "report.html". */
    name: text("name").notNull(),
    label: text("label").notNull(),
    s3Key: text("s3_key").notNull().unique(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("run_artifacts_run_name_idx").on(t.runId, t.name)],
);

/* ---------- Test data (E2.6). Credentials come from External Secrets; only the path is stored. ---------- */

/** Hook shape is TBD-6 (HTTP or SQL); jsonb until it settles. */
export type Hook = { kind: "http"; name: string; url: string; method?: string } | { kind: "sql"; name: string; statement: string };

export const testDataPools = pgTable("test_data_pools", {
  targetId: uuid("target_id")
    .primaryKey()
    .references(() => targets.id),
  /** Identities in the pool; split per runner pod at start. */
  total: integer("total").notNull().default(0),
  secretPath: text("secret_path").notNull(),
  seedHook: jsonb("seed_hook").$type<Hook>(),
  cleanupHook: jsonb("cleanup_hook").$type<Hook>(),
  updatedAt: updatedAt(),
});

/* ---------- Audit log (E1.4, D7): append-only, monthly partitions, 1-year retention. ---------- */

/**
 * Also the run timeline: every state change writes a row with run_id in the same transaction.
 * No FKs on purpose: audit rows outlive what they describe. PARTITION BY RANGE (at) is added in 0000_init.sql
 * by hand (the pk is (id, at) for that reason).
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigint("id", { mode: "number" }).notNull().generatedAlwaysAsIdentity(),
    at: ts("at").notNull().defaultNow(),
    /** Null for system actors (worker, runner pod callbacks). */
    actorId: uuid("actor_id"),
    /** Snapshot of the name at the time; people get renamed, the log doesn't. */
    actorName: text("actor_name").notNull(),
    /** Short verb phrase, e.g. "Approved", "Changed role", "Aborted: lease expired". */
    action: text("action").notNull(),
    detail: text("detail"),
    projectId: text("project_id"),
    runId: text("run_id"),
    data: jsonb("data").$type<Record<string, unknown>>(),
  },
  (t) => [primaryKey({ columns: [t.id, t.at] }), index("audit_logs_run_idx").on(t.runId, t.at), index("audit_logs_project_at_idx").on(t.projectId, t.at)],
);
