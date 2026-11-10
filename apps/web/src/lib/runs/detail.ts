import type { PreflightResults, RunManifest } from "@btb/contracts";
import { forHash } from "@btb/core/approvals";

import { RUN_STATUS_META } from "@/lib/run-status";
import type { ProjectCatalog } from "./catalog";
import { UNIT, approversFor, evaluatePlan } from "@btb/core/policy";
import { resultsOf, type SummaryRow } from "./results";
import type { ApprovalRecord, Baseline, RunArtifact, ReleasePoint, RunDetail, RunListItem, TimelineEvent } from "./types";

/*
 * Run detail (UI-05), built from what lib/server/runs.ts loads: the run row, its approvals, its audit rows
 * (the timeline), the summary and the pinned baseline. Pure, so the rules here are unit-tested.
 */

export const EDITABLE = new Set(["draft", "pending_approval", "approved"]);

/** A run row with what the list shows, plus what only the server needs. */
export interface RunRecord extends RunListItem {
  manifest: RunManifest;
  manifestHash: string;
  preflight: PreflightResults | null;
  submittedAt?: string;
  startRequestedAt?: string;
  queuedBehind?: string;
  /** Web app that created the run, worker that started it (null on older runs or before the start). */
  versions: { web: string | null; worker: string | null };
  /** Database ids behind the names. Never sent to the browser. */
  ref: { targetId: string; scenarioId: string; scenarioVersionId: string; createdById: string };
}

export interface ApprovalRow {
  userId: string | null;
  userName: string | null;
  rule: string | null;
  manifestHash: string;
  decision: "approved" | "rejected";
  note: string | null;
  createdAt: Date;
  expiresAt: Date | null;
}

export interface DetailInputs {
  run: RunRecord;
  projectName: string;
  catalog: ProjectCatalog;
  approvals: ApprovalRow[];
  timeline: TimelineEvent[];
  summary: SummaryRow | null;
  baseline: (Baseline & { summary: SummaryRow | null }) | null;
  artifacts: RunArtifact[];
  trend?: ReleasePoint[];
  /** GRAFANA_URL: Grafana with the infra/grafana dashboards. */
  grafana?: string;
}

/** E8.5: the k6 run dashboard filtered to this run, over its time range plus a minute each side. */
export function grafanaRunUrl(base: string | undefined, run: Pick<RunListItem, "id" | "startedAt" | "endedAt">): string | null {
  if (!base || !/^https?:\/\//.test(base) || !run.startedAt) return null;
  const from = Date.parse(run.startedAt) - 60_000;
  const to = run.endedAt ? Date.parse(run.endedAt) + 60_000 : "now";
  return `${base.replace(/\/+$/, "")}/d/btb-k6-run/k6-run?var-testid=${encodeURIComponent(run.id)}&from=${from}&to=${to}`;
}

/** The plan input a stored run corresponds to (also what Edit starts from). */
export function planInputOf(run: RunListItem) {
  return {
    scenario: run.scenario.name,
    version: run.scenario.version,
    environment: run.environment,
    target: run.target.id,
    preset: run.preset,
    network: run.network ?? undefined,
    releaseId: run.releaseId,
  };
}

export function buildRunDetail(x: DetailInputs, now: Date): RunDetail {
  const { ref: _ref, preflight, submittedAt: _s, startRequestedAt: _r, queuedBehind: _q, versions, ...run } = x.run;
  const required = approversFor(run.environment, run.preset);

  const current = forHash(x.approvals, run.manifestHash);
  const voidedApprovals = x.approvals.filter((a) => a.decision === "approved" && a.userId && a.manifestHash !== run.manifestHash).length;
  const approvalRecords: ApprovalRecord[] = current.map((a) => ({
    by: a.userName ?? "Policy",
    byId: a.userId ?? undefined,
    at: a.createdAt.toISOString(),
    expiresAt: (a.expiresAt ?? a.createdAt).toISOString(),
    rule: a.rule ?? undefined,
    hash: a.manifestHash,
  }));
  const approvalExpiresAt = approvalRecords.length ? approvalRecords.map((a) => a.expiresAt).sort()[0] : undefined;
  // A policy approval never needs a person to renew it: Start re-checks policy and records a fresh one.
  const approvalExpired = required > 0 && !!approvalExpiresAt && approvalExpiresAt < now.toISOString();

  // Policy may have changed since the run was approved (ceilings, targets): Start checks again.
  const { violations } = evaluatePlan(x.catalog, planInputOf(run));
  const start: RunDetail["start"] =
    run.status === "approved"
      ? approvalExpired
        ? { ok: false, reason: "The approval expired. Edit the run to submit it again." }
        : violations.length
          ? { ok: false, reason: `Policy now rejects this plan: ${violations[0].message}` }
          : { ok: true }
      : run.status === "draft"
        ? { ok: false, reason: "Drafts can't start. Edit and save to submit it." }
        : run.status === "pending_approval"
          ? { ok: false, reason: `Waiting for ${required === 2 ? "2 approvers" : "an approver"}.` }
          : { ok: false, reason: `The run is ${RUN_STATUS_META[run.status].label.toLowerCase()}.` };

  const caveats = run.verdict?.caveats ?? [];
  const steps = x.catalog.journeys.find((j) => j.id === run.manifest.scenario.journey)?.steps;
  const results = resultsOf(run.manifest, run.durationSec, caveats, x.summary, steps);
  const pinned = x.baseline;
  const baseResults = pinned && pinned.runId !== run.id ? resultsOf(run.manifest, run.durationSec, [], pinned.summary) : null;
  const baseline = pinned
    ? {
        runId: pinned.runId,
        setBy: pinned.setBy,
        setAt: pinned.setAt,
        isThis: pinned.runId === run.id,
        compare:
          results && baseResults
            ? {
                p95Ms: { base: baseResults.p95Ms, now: results.p95Ms },
                errorRatePct: { base: baseResults.errorRatePct, now: results.errorRatePct },
                peakRps: { base: baseResults.peakRps, now: results.peakRps },
              }
            : null,
      }
    : null;

  return {
    ...run,
    projectName: x.projectName,
    load: { value: run.manifest.load.target, unit: UNIT[run.manifest.load.model] },
    approvalsRequired: required,
    approvalRecords,
    approvalExpiresAt,
    approvalExpired,
    voidedApprovals,
    timeline: x.timeline,
    preflight,
    artifacts: x.artifacts,
    // No log aggregation in the local stack yet (E5.8).
    logsUrl: null,
    grafanaUrl: grafanaRunUrl(x.grafana, run),
    versions: { ...versions, runner: run.manifest.scenario.imageVersion },
    editable: EDITABLE.has(run.status),
    start,
    results,
    trend: x.trend ?? [],
    baseline,
    canBaseline: run.status === "completed" && !!results,
  };
}
