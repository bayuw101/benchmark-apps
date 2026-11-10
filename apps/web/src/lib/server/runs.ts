import "server-only";

import { redisKeys, type LiveSample, type RunManifest, type Tone } from "@btb/contracts";
import { SYSTEM_ACTOR } from "@btb/core/audit";
import { and, asc, count, desc, eq, gt, ilike, inArray, isNotNull, ne, notInArray, or, type SQL } from "drizzle-orm";

import { db, schema } from "@/db";
import { validApprovals } from "@btb/core/approvals";

import type { ProjectCatalog } from "@/lib/runs/catalog";
import { buildRunDetail, type RunRecord } from "@/lib/runs/detail";
import { approversFor } from "@btb/core/policy";
import { IN_FLIGHT, type Environment, type ReleasePoint, type RunDetail, type RunFilters, type RunListItem, type RunPage, type TimelineEvent } from "@/lib/runs/types";
import { getCatalog } from "./catalog";
import { redis } from "./redis";

/*
 * Reading runs (UI-04, UI-05) from Postgres, plus the latest live sample from Redis. Writes live in
 * lib/runs/actions.ts and lib/runs/approvals.ts.
 */

const { approvals, auditLogs, baselines, projects, runArtifacts, runSummaries, runs, scenarioVersions, scenarios, targets, users } = schema;

export const RUN_ID_RE = /^RUN-\d{1,9}$/;

function selectRuns(where: SQL | undefined) {
  return db
    .select({
      run: runs,
      targetName: targets.name,
      scenarioId: scenarios.id,
      scenarioName: scenarios.name,
      version: scenarioVersions.version,
      creatorName: users.name,
    })
    .from(runs)
    .innerJoin(targets, eq(targets.id, runs.targetId))
    .innerJoin(scenarioVersions, eq(scenarioVersions.id, runs.scenarioVersionId))
    .innerJoin(scenarios, eq(scenarios.id, scenarioVersions.scenarioId))
    .innerJoin(users, eq(users.id, runs.createdBy))
    .where(where);
}

type Row = Awaited<ReturnType<typeof selectRuns>>[number];

const iso = (d: Date | null) => d?.toISOString();

function toRecord({ run, targetName, scenarioId, scenarioName, version, creatorName }: Row): RunRecord {
  return {
    id: run.id,
    projectId: run.projectId,
    scenario: { name: scenarioName, version },
    target: { id: targetName, name: targetName },
    environment: run.environment as Environment,
    preset: run.preset,
    status: run.status,
    releaseId: run.releaseId ?? undefined,
    createdBy: { name: creatorName },
    createdAt: run.createdAt.toISOString(),
    startedAt: iso(run.startedAt),
    endedAt: iso(run.endedAt),
    durationSec: run.durationSec,
    verdict: run.verdict ? { result: run.verdict, caveats: run.caveats } : undefined,
    abortReason: run.abortReason ?? undefined,
    manifestHash: run.manifestHash,
    network: run.network,
    manifest: run.manifest as unknown as RunManifest,
    preflight: run.preflight,
    submittedAt: iso(run.submittedAt),
    startRequestedAt: iso(run.startRequestedAt),
    queuedBehind: run.queuedBehind ?? undefined,
    versions: { web: run.webVersion, worker: run.workerVersion },
    ref: { targetId: run.targetId, scenarioId, scenarioVersionId: run.scenarioVersionId, createdById: run.createdBy },
  };
}

/** What the browser may see: no database ids, no manifest. */
export function toListItem(r: RunRecord): RunListItem {
  const { manifest: _m, preflight: _p, submittedAt: _s, startRequestedAt: _r, queuedBehind: _q, versions: _v, ref: _ref, ...item } = r;
  return item;
}

export async function getRun(id: string): Promise<RunRecord | null> {
  if (!RUN_ID_RE.test(id)) return null;
  const [row] = await selectRuns(eq(runs.id, id)).limit(1);
  return row ? toRecord(row) : null;
}

export async function listRuns(where: SQL | undefined): Promise<RunRecord[]> {
  return (await selectRuns(where).orderBy(desc(runs.createdAt))).map(toRecord);
}

/** Every sample the live loop wrote for a run, from index `from` on. */
export async function readSamples(id: string, from = 0): Promise<LiveSample[]> {
  const raw = await redis().lrange(redisKeys.samples(id), from, -1);
  return raw.map((s) => JSON.parse(s) as LiveSample);
}

async function latestSample(id: string): Promise<LiveSample | null> {
  try {
    const raw = await redis().lindex(redisKeys.samples(id), -1);
    return raw ? (JSON.parse(raw) as LiveSample) : null;
  } catch {
    return null; // Redis down: the list still renders, without live numbers.
  }
}

/** Approvals so far (pending runs), queue position (queued runs) and latest live numbers (running runs). */
async function withExtras(records: RunRecord[], now: Date): Promise<RunListItem[]> {
  const pending = records.filter((r) => r.status === "pending_approval");
  const queued = records.filter((r) => r.status === "queued" && r.queuedBehind);

  const [approvalRows, queueRows, blockerRows] = await Promise.all([
    pending.length
      ? db
          .select()
          .from(approvals)
          .where(and(inArray(approvals.runId, pending.map((r) => r.id)), eq(approvals.decision, "approved"), gt(approvals.expiresAt, now)))
      : [],
    queued.length
      ? db
          .select({ id: runs.id, environment: runs.environment })
          .from(runs)
          .where(eq(runs.status, "queued"))
          .orderBy(asc(runs.startRequestedAt), asc(runs.id))
      : [],
    queued.length
      ? db
          .select({ id: runs.id, targetId: runs.targetId })
          .from(runs)
          .where(inArray(runs.id, queued.map((r) => r.queuedBehind!)))
      : [],
  ]);

  return Promise.all(
    records.map(async (r) => {
      const item = toListItem(r);
      if (r.status === "pending_approval") {
        const rows = approvalRows.filter((a) => a.runId === r.id);
        item.approvals = { required: approversFor(r.environment, r.preset), approved: validApprovals(rows, r.manifestHash, now).length };
      }
      if (r.status === "queued" && r.queuedBehind) {
        const position = queueRows.filter((q) => q.environment === r.environment).findIndex((q) => q.id === r.id) + 1;
        const blocker = blockerRows.find((b) => b.id === r.queuedBehind);
        item.queue = { position: Math.max(position, 1), blockedBy: r.queuedBehind, scope: blocker?.targetId === r.ref.targetId ? "target" : "namespace" };
      }
      if (r.status === "running" || r.status === "stopping") {
        const s = await latestSample(r.id);
        if (s) item.live = { p95Ms: s.p95Ms, thresholdMs: r.manifest.thresholds?.p95Ms ?? 0, vus: s.vus, rps: s.rps };
      }
      return item;
    }),
  );
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** In-flight runs (unfiltered) plus a filtered page of history, newest first. `cursor` is an offset. */
export async function queryRuns(projectId: string, filters: RunFilters, cursor: string | null, limit: number, now: Date): Promise<RunPage> {
  const offset = cursor ? Number(cursor) : 0;
  const q = filters.q ? `%${escapeLike(filters.q)}%` : null;
  const history = and(
    eq(runs.projectId, projectId),
    notInArray(runs.status, IN_FLIGHT),
    filters.target ? eq(targets.name, filters.target) : undefined,
    filters.scenario ? eq(scenarios.name, filters.scenario) : undefined,
    filters.release ? eq(runs.releaseId, filters.release) : undefined,
    filters.result ? eq(runs.verdict, filters.result) : undefined,
    q ? or(ilike(runs.id, q), ilike(scenarios.name, q), ilike(targets.name, q), ilike(runs.releaseId, q), ilike(users.name, q)) : undefined,
  );

  const [active, page, [{ total }], targetNames, scenarioNames, releases] = await Promise.all([
    listRuns(and(eq(runs.projectId, projectId), inArray(runs.status, IN_FLIGHT))),
    selectRuns(history).orderBy(desc(runs.createdAt), desc(runs.id)).limit(limit).offset(offset),
    db
      .select({ total: count() })
      .from(runs)
      .innerJoin(targets, eq(targets.id, runs.targetId))
      .innerJoin(scenarioVersions, eq(scenarioVersions.id, runs.scenarioVersionId))
      .innerJoin(scenarios, eq(scenarios.id, scenarioVersions.scenarioId))
      .innerJoin(users, eq(users.id, runs.createdBy))
      .where(history),
    db.selectDistinct({ name: targets.name }).from(runs).innerJoin(targets, eq(targets.id, runs.targetId)).where(eq(runs.projectId, projectId)).orderBy(asc(targets.name)),
    db
      .selectDistinct({ name: scenarios.name })
      .from(runs)
      .innerJoin(scenarioVersions, eq(scenarioVersions.id, runs.scenarioVersionId))
      .innerJoin(scenarios, eq(scenarios.id, scenarioVersions.scenarioId))
      .where(eq(runs.projectId, projectId))
      .orderBy(asc(scenarios.name)),
    db.selectDistinct({ id: runs.releaseId }).from(runs).where(eq(runs.projectId, projectId)).orderBy(asc(runs.releaseId)),
  ]);

  return {
    active: await withExtras(active, now),
    items: await withExtras(page.map(toRecord), now),
    nextCursor: offset + limit < total ? String(offset + limit) : null,
    total,
    facets: {
      targets: targetNames.map((t) => ({ id: t.name, name: t.name })),
      scenarios: scenarioNames.map((s) => s.name),
      releases: releases.flatMap((r) => (r.id ? [r.id] : [])),
    },
  };
}

/** Everything the Run detail page shows, from the run's rows. Pass `catalog` when loading many runs of one project. */
export async function loadRunDetail(run: RunRecord, now: Date, catalog?: ProjectCatalog): Promise<RunDetail> {
  const [projectCatalog, [project], approvalRows, auditRows, [summary], [pinned], artifacts] = await Promise.all([
    catalog ?? getCatalog(run.projectId),
    db.select({ name: projects.name }).from(projects).where(eq(projects.id, run.projectId)),
    db
      .select({
        userId: approvals.userId,
        userName: users.name,
        rule: approvals.rule,
        manifestHash: approvals.manifestHash,
        decision: approvals.decision,
        note: approvals.note,
        createdAt: approvals.createdAt,
        expiresAt: approvals.expiresAt,
      })
      .from(approvals)
      .leftJoin(users, eq(users.id, approvals.userId))
      .where(eq(approvals.runId, run.id))
      .orderBy(asc(approvals.createdAt)),
    db.select().from(auditLogs).where(eq(auditLogs.runId, run.id)).orderBy(asc(auditLogs.at), asc(auditLogs.id)),
    db.select().from(runSummaries).where(eq(runSummaries.runId, run.id)),
    db
      .select({ runId: baselines.runId, setBy: users.name, setAt: baselines.setAt })
      .from(baselines)
      .innerJoin(users, eq(users.id, baselines.setBy))
      .where(and(eq(baselines.targetId, run.ref.targetId), eq(baselines.scenarioId, run.ref.scenarioId), eq(baselines.preset, run.preset))),
    db
      .select({ name: runArtifacts.name, label: runArtifacts.label, contentType: runArtifacts.contentType, sizeBytes: runArtifacts.sizeBytes })
      .from(runArtifacts)
      .where(eq(runArtifacts.runId, run.id))
      .orderBy(asc(runArtifacts.name)),
  ]);

  const [[baseSummary], trend] = await Promise.all([
    pinned && pinned.runId !== run.id ? db.select().from(runSummaries).where(eq(runSummaries.runId, pinned.runId)) : Promise.resolve([]),
    run.status === "completed" ? releaseTrend(run) : Promise.resolve([]),
  ]);

  const timeline: TimelineEvent[] = auditRows.map((a) => ({
    at: a.at.toISOString(),
    label: a.action,
    by: a.actorName === SYSTEM_ACTOR ? undefined : a.actorName,
    note: a.detail ?? undefined,
    tone: (a.data?.tone as Tone | undefined) ?? "neutral",
  }));

  return buildRunDetail(
    {
      run,
      projectName: project?.name ?? run.projectId,
      catalog: projectCatalog,
      approvals: approvalRows,
      timeline,
      summary: summary ?? null,
      baseline: pinned ? { runId: pinned.runId, setBy: pinned.setBy, setAt: pinned.setAt.toISOString(), summary: pinned.runId === run.id ? (summary ?? null) : (baseSummary ?? null) } : null,
      artifacts,
      trend,
      grafana: process.env.GRAFANA_URL,
    },
    now,
  );
}

/** PROPOSAL: how many releases the trend shows. */
const TREND_RELEASES = 12;

/** E9.7: the latest completed run per release ID of this scenario + target + preset (this run for its own release), oldest release first. */
async function releaseTrend(run: RunRecord): Promise<ReleasePoint[]> {
  const rows = await db
    .selectDistinctOn([runs.releaseId], {
      releaseId: runs.releaseId,
      runId: runs.id,
      endedAt: runs.endedAt,
      verdict: runs.verdict,
      p95Ms: runSummaries.p95Ms,
      errorRatePct: runSummaries.errorRatePct,
      peakRps: runSummaries.peakRps,
    })
    .from(runs)
    .innerJoin(runSummaries, eq(runSummaries.runId, runs.id))
    .innerJoin(scenarioVersions, eq(scenarioVersions.id, runs.scenarioVersionId))
    .where(
      and(
        eq(scenarioVersions.scenarioId, run.ref.scenarioId),
        eq(runs.targetId, run.ref.targetId),
        eq(runs.preset, run.preset),
        eq(runs.status, "completed"),
        isNotNull(runs.releaseId),
        run.releaseId ? or(ne(runs.releaseId, run.releaseId), eq(runs.id, run.id)) : undefined,
      ),
    )
    .orderBy(runs.releaseId, desc(runs.endedAt));
  return rows
    .flatMap((r) => (r.releaseId && r.endedAt ? [{ ...r, releaseId: r.releaseId, endedAt: r.endedAt.toISOString(), verdict: r.verdict ?? null }] : []))
    .sort((a, b) => a.endedAt.localeCompare(b.endedAt))
    .slice(-TREND_RELEASES);
}

export async function getRunDetail(id: string, now: Date): Promise<RunDetail | null> {
  const run = await getRun(id);
  return run ? loadRunDetail(run, now) : null;
}
