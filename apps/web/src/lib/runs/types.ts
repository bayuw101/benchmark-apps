import type { AbortReason, BrowserStep, Environment, JourneySummary, NetworkProfile, PreflightResults, Preset, RunManifest, Tone, VerdictCaveat } from "@btb/contracts";

import type { RunStatus } from "@/lib/run-status";

/*
 * API shapes the web app serves. Types shared with the worker live in @btb/contracts and are
 * re-exported here so components keep one import path.
 */

export type {
  AbortReason,
  BrowserStep,
  Environment,
  NetworkProfile,
  PreflightKey,
  PreflightResults,
  PreflightState,
  PolicyViolation,
  Preset,
  VerdictCaveat,
} from "@btb/contracts";

export interface RunListItem {
  id: string;
  projectId: string;
  scenario: { name: string; version: number };
  target: { id: string; name: string };
  environment: Environment;
  preset: Preset;
  status: RunStatus;
  /** Optional, never blocks a run (story 5). */
  releaseId?: string;
  createdBy: { name: string };
  /** ISO timestamps. */
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  /** Planned length of the load profile, in seconds. */
  durationSec: number;
  verdict?: { result: "pass" | "fail"; caveats: VerdictCaveat[] };
  /** Why a queued run waits (story 4): 1 active run per target, 2 per namespace. */
  queue?: { position: number; blockedBy: string; scope: "target" | "namespace" };
  /** pending_approval: 1 approver on staging, 2 on prod-like. */
  approvals?: { required: number; approved: number };
  abortReason?: AbortReason;
  /** Latest live numbers for in-flight runs (the live loop, UI-09, will stream these). */
  live?: { p95Ms: number; thresholdMs: number; vus: number; rps: number };
  /** SHA-256 of the manifest approvals are bound to (E3.2). */
  manifestHash?: string;
  /** Browser-step network profile; null for protocol-only scenarios. */
  network?: NetworkProfile | null;
}

/** The 7 preflight checks (PRD E3.4) are typed in @btb/contracts. Labels live with the checklist component. */

export type { Tone } from "@btb/contracts";

export interface TimelineEvent {
  at: string;
  label: string;
  by?: string;
  note?: string;
  tone: Tone;
}

/** An approval bound to the manifest hash it was given for (E4). `rule` = auto-approved by policy. */
export interface ApprovalRecord {
  by: string;
  /** The approver's user id (records given in the app). */
  byId?: string;
  at: string;
  expiresAt: string;
  rule?: string;
  /** Manifest hash it was given for; an edit changes the hash and the approval stops counting (E4.2). */
  hash?: string;
}

export interface RunArtifact {
  name: string;
  label: string;
  /** MIME type as stored, e.g. "application/json", "image/png". Decides how the viewer shows it. */
  contentType: string;
  sizeBytes: number;
}

export interface RunResults {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  errorRatePct: number;
  peakRps: number;
  maxVus: number;
  planned: { load: number; unit: string; durationSec: number };
  achieved: { load: number; durationSec: number };
  thresholds: { p95Ms: number; errorRatePct: number } | null;
  checks: { p95: boolean; errors: boolean };
  /** Seconds of missing telemetry (measurement gap caveat). */
  gapSec: number;
  browser: BrowserStep[] | null;
  /** Funnel steps of protocol journeys that report them (E7.4); null otherwise. */
  journey: JourneySummary | null;
  /** Null = integrity not verified (no data source for this target, or it didn't answer). */
  integrity: { oversoldSeats: number; doubleCharges: number; chargedNoTicket: number } | null;
  caveats: VerdictCaveat[];
}


/** One release in the trend (E9.7): the latest completed run of the same scenario, target and preset with that release ID. */
export interface ReleasePoint {
  releaseId: string;
  runId: string;
  endedAt: string;
  p95Ms: number;
  errorRatePct: number;
  peakRps: number;
  verdict: "pass" | "fail" | null;
}

export interface Baseline {
  runId: string;
  setBy: string;
  setAt: string;
}


/** GET /api/runs/[id]: everything the Run detail page shows (UI-05). */
export interface RunDetail extends RunListItem {
  projectName: string;
  manifest: RunManifest;
  manifestHash: string;
  load: { value: number; unit: string } | null;
  /** 0 = auto-approved by policy. */
  approvalsRequired: 0 | 1 | 2;
  approvalRecords: ApprovalRecord[];
  /** Earliest expiry among the approvals that count; a run can't start after it (N4). */
  approvalExpiresAt?: string;
  /** The approvals that count have run out (needs re-approval). */
  approvalExpired: boolean;
  /** Approvals given for an earlier hash, voided by an edit. */
  voidedApprovals: number;
  timeline: TimelineEvent[];
  /** Null until someone presses Start. */
  preflight: PreflightResults | null;
  artifacts: RunArtifact[];
  /** CloudWatch Logs Insights, filtered by run_id (E5.8). Null until pods exist. */
  logsUrl: string | null;
  /** Edit is allowed before the run starts. */
  editable: boolean;
  /** Whether Start would be accepted (role aside), and why not. */
  start: { ok: boolean; reason?: string };
  /** End-of-run summary (UI-10); null until the run has sent load and ended. */
  results: RunResults | null;
  /** Release trend for this scenario + target + preset, oldest first; empty unless the run completed. */
  trend: ReleasePoint[];
  /** The pinned baseline for this target + scenario, and how this run compares. */
  baseline: (Baseline & { isThis: boolean; compare: BaselineCompare | null }) | null;
  /** Can be pinned as the baseline (completed with results). */
  canBaseline: boolean;
  /** Grafana with var-testid and the run's time range (E8.5). */
  grafanaUrl: string | null;
  /** E0.1: web app that created the run, worker that started it (null on older runs or before the start), runner image tag. */
  versions: { web: string | null; worker: string | null; runner: string };
}

export interface BaselineCompare {
  p95Ms: { base: number; now: number };
  errorRatePct: { base: number; now: number };
  peakRps: { base: number; now: number };
}

export interface RunFilters {
  target?: string;
  scenario?: string;
  release?: string;
  result?: "pass" | "fail";
  q?: string;
}

export interface RunPage {
  /** In-flight runs for the project (starting, running, stopping, queued). Not filtered. */
  active: RunListItem[];
  /** History page: everything else, filtered, newest first. */
  items: RunListItem[];
  nextCursor: string | null;
  total: number;
  /** Values the filter menus offer, from the project's whole history. */
  facets: { targets: { id: string; name: string }[]; scenarios: string[]; releases: string[] };
}

export const IN_FLIGHT: RunStatus[] = ["starting", "running", "stopping", "queued"];

export const PRESET_LABEL: Record<Preset, string> = {
  smoke: "Smoke",
  baseline: "Baseline",
  peak: "Peak",
  spike: "Spike",
  soak: "Soak",
  stress: "Stress",
};

export const ABORT_LABEL: Record<AbortReason, string> = {
  emergency_stop: "Emergency stop",
  lease_expired: "Lease expired",
  threshold: "Threshold breached",
  target_health: "Target health probe failed",
  telemetry_lost: "Telemetry lost",
  policy_breach: "Policy breach",
  kubernetes_failure: "Kubernetes failure",
};

export const CAVEAT_LABEL: Record<VerdictCaveat, string> = {
  measurement_gap: "Measurement gap",
  generator_saturated: "Generator saturated",
  integrity_not_verified: "Integrity not verified",
};
