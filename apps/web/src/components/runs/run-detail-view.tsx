"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CircleAlert, CircleCheck, Clock, Eye, ExternalLink, FileImage, FileJson, FileText, Info, ListX, Lock, Pencil, Pin, Play, RotateCw, SearchX, TriangleAlert, UserRound } from "lucide-react";

import { cn } from "@/lib/utils";
import { clock, formatDuration, relativeTime } from "@/lib/time";
import { useNow } from "@/lib/use-now";
import type { ProjectCatalog } from "@/lib/runs/catalog";
import { ENVIRONMENT_LABEL, NETWORK_PROFILES } from "@btb/core/policy";
import { ABORT_LABEL, CAVEAT_LABEL, IN_FLIGHT, PRESET_LABEL, type AbortReason, type RunArtifact, type RunDetail, type Tone } from "@/lib/runs/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/arbiter/empty-state";
import { PageBody, PageShell } from "@/components/arbiter/page-shell";
import { notify } from "@/components/arbiter/toast";
import { HashDisplay } from "@/components/btb/hash-display";
import { PREFLIGHT_CHECKS, PreflightChecklist } from "@/components/btb/preflight-checklist";
import { RunStatusBadge } from "@/components/btb/run-status-badge";
import { LinkPending } from "@/components/arbiter/link-pending";
import { EmergencyStop } from "@/components/btb/emergency-stop";
import { ArtifactViewer, DownloadButton, canPreview } from "./artifact-viewer";
import { CreateRunForm } from "./create-run-form";
import { LiveRunPanel, useLiveRun } from "./live-run";
import { RunResultsSection } from "./run-results";
import { Hint } from "@/components/ui/tooltip";

class RunError extends Error {
  constructor(readonly status: number, readonly body: { reason?: string; preflight?: RunDetail["preflight"] } = {}) {
    super(`run request failed: ${status}`);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (res.ok) return res.json();
  throw new RunError(res.status, await res.json().catch(() => ({})));
}

const ABORT_EXPLAIN: Record<AbortReason, string> = {
  threshold: "p95 latency or the error rate crossed its abort-on-fail threshold, so k6 stopped the load.",
  emergency_stop: "Someone pressed Emergency stop. The TestRun was deleted and every runner pod stopped.",
  target_health: "The target's health endpoint failed 3 checks in a row (it's probed every 10 seconds).",
  telemetry_lost: "Runner metrics stopped arriving, so the run stopped rather than run blind.",
  lease_expired: "The runner pods couldn't renew their lease with the API, so they stopped k6 themselves.",
  policy_breach: "A runner pod checked the run before sending load and refused: the manifest, its approval or the target allowlist didn't match.",
  kubernetes_failure: "Kubernetes couldn't keep the runner pods going.",
};

const TONE_BOX: Record<Tone, string> = {
  neutral: "border-border bg-muted text-foreground",
  info: "border-info/25 bg-info-soft text-info",
  success: "border-success/25 bg-success-soft text-success",
  warning: "border-warning/30 bg-warning-soft text-warning",
  danger: "border-danger/30 bg-danger-soft text-danger",
};
const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-border-strong",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};
const TONE_ICON: Record<Tone, React.ReactNode> = {
  neutral: <Info />,
  info: <Info />,
  success: <CircleCheck />,
  warning: <TriangleAlert />,
  danger: <CircleAlert />,
};

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** Timeline times: a clock time shows the sequence ("21 h ago" eight times doesn't); the date only when not today. */
const eventTime = (iso: string, now: Date) => {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === now.toDateString() ? time : `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, ${time}`;
};

/** One sentence on where the run stands and what happens next. */
function statusCallout(d: RunDetail, now: Date): { tone: Tone; title: string; text: React.ReactNode } {
  const failedChecks = d.preflight ? PREFLIGHT_CHECKS.filter((c) => d.preflight?.[c.key]?.state === "fail") : [];
  switch (d.status) {
    case "draft":
      return { tone: "neutral", title: "Draft", text: "Not submitted yet. Edit and save it to submit for approval." };
    case "pending_approval":
      return {
        tone: "warning",
        title: "Waiting for approval",
        text: `${d.approvalRecords.length} of ${plural(d.approvalsRequired, "approval")}. Approvers see this exact manifest and hash.`,
      };
    case "approved":
      if (failedChecks.length) return { tone: "danger", title: `Preflight failed: ${failedChecks.map((c) => c.label).join(", ")}`, text: "Fix the failing check, then start again. Nothing was sent to the target." };
      return d.start.ok
        ? { tone: "info", title: "Ready to start", text: `Approved until ${d.approvalExpiresAt ? when(d.approvalExpiresAt) : "—"}. Start runs the 7 preflight checks first.` }
        : { tone: "warning", title: "Can't start", text: d.start.reason };
    case "queued":
      return {
        tone: "warning",
        title: `#${d.queue?.position ?? 1} in queue`,
        text: d.queue ? (
          <>
            Waiting for{" "}
            <Link href={`/runs/${d.queue.blockedBy}`} className="font-mono font-semibold underline underline-offset-2">
              {d.queue.blockedBy}
              <LinkPending className="ml-1 inline-block size-3 align-[-1px]" />
            </Link>{" "}
            · 1 active run per target. It starts by itself while the approval is valid.
          </>
        ) : (
          "Waiting for a free slot."
        ),
      };
    // The live panel above covers these; the callout only says what to do.
    case "starting":
      return { tone: "info", title: "Runner pods are starting", text: "Load begins when every pod has verified the plan. Emergency stop is at the top of the page." };
    case "running":
    case "stopping": {
      const elapsed = d.startedAt ? (now.getTime() - new Date(d.startedAt).getTime()) / 1000 : 0;
      return {
        tone: d.status === "running" ? "info" : "danger",
        title: d.status === "running" ? "Running" : "Stopping",
        text: d.status === "running" ? `${clock(Math.min(elapsed, d.durationSec))} of ${clock(d.durationSec)}. Live numbers above; Emergency stop is at the top of the page.` : "The TestRun was deleted. Runner pods are shutting down.",
      };
    }
    case "completed": {
      const pass = d.verdict?.result === "pass";
      const caveats = d.verdict?.caveats ?? [];
      return {
        tone: pass ? "success" : "danger",
        title: `Completed · ${pass ? "Pass" : "Fail"}`,
        text: `${caveats.length ? `Caveats: ${caveats.map((c) => CAVEAT_LABEL[c]).join(", ")}. ` : ""}Results and the baseline comparison are below.`,
      };
    }
    case "aborted":
      return { tone: "danger", title: `Aborted: ${d.abortReason ? ABORT_LABEL[d.abortReason] : "unknown reason"}`, text: d.abortReason ? ABORT_EXPLAIN[d.abortReason] : "No reason was recorded." };
    case "failed":
      return { tone: "danger", title: "Failed: system error", text: "The runner pods didn't schedule (Kubernetes failure). No load was measured, so there's no verdict." };
    case "rejected":
      return { tone: "danger", title: "Rejected", text: d.timeline.find((e) => e.label === "Rejected")?.note ?? "An approver rejected this run." };
  }
}

function Card({ title, aside, children, className }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border border-border bg-card", className)}>
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-5 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-label font-semibold tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-1 truncate text-sm">{children}</dd>
    </div>
  );
}

const version = (v: string | null) => (v ? <span className="font-mono text-xs">{v}</span> : <span className="text-muted-foreground">—</span>);

function DetailSkeleton() {
  return (
    <div className="grid gap-5" aria-busy="true" aria-label="Loading run">
      <Skeleton className="h-44" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-5">
          <Skeleton className="h-72" />
          <Skeleton className="h-64" />
        </div>
        <div className="grid content-start gap-5">
          <Skeleton className="h-48" />
          <Skeleton className="h-36" />
        </div>
      </div>
    </div>
  );
}

/** UI-05 Run detail: status and what's next, then timeline, preflight, manifest, approvals, logs and artifacts. */
export function RunDetailView({ id, canAct, catalog }: { id: string; canAct: boolean; catalog: ProjectCatalog }) {
  const queryClient = useQueryClient();
  const now = useNow(1000);
  const [editing, setEditing] = React.useState(false);
  const [viewing, setViewing] = React.useState<RunArtifact>();
  const simulate = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("simulate") : null;

  const query = useQuery({
    queryKey: ["run", id, simulate],
    queryFn: () => request<RunDetail>(`/api/runs/${encodeURIComponent(id)}${simulate ? `?simulate=${simulate}` : ""}`),
    retry: (count, error) => !(error instanceof RunError && [403, 404].includes(error.status)) && count < 2,
    // In-flight runs move on their own; poll until they settle.
    refetchInterval: (q) => (q.state.data && IN_FLIGHT.includes(q.state.data.status) ? 5000 : false),
  });
  const d = query.data;

  const start = useMutation({
    mutationFn: () => request<RunDetail>(`/api/runs/${encodeURIComponent(id)}/start`, { method: "POST" }),
    onSuccess: (detail) => {
      queryClient.setQueryData(["run", id, simulate], detail);
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
      if (detail.status === "queued") notify.success(`${detail.id} queued`, `#${detail.queue?.position ?? 1} in line, waiting for ${detail.queue?.blockedBy}. It starts by itself.`);
      else notify.success(`${detail.id} starting`, "Preflight passed. Runner pods are starting.");
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: ["run", id] });
      if (error instanceof RunError && error.body.preflight) {
        const failed = PREFLIGHT_CHECKS.filter((c) => error.body.preflight?.[c.key]?.state === "fail").map((c) => c.label);
        notify.error("Preflight failed", `${failed.join(", ")}. Nothing was sent to the target.`);
      } else if (error instanceof RunError && error.status === 409) notify.error("This run can't start", error.body.reason);
      else if (error instanceof RunError && error.status === 403) notify.error("You can't start runs", "Starting runs needs the engineer role or higher.");
      else notify.error("Couldn't start the run", "The run service didn't answer. Try again.");
    },
  });

  // Live view while load is (about to be) on the target (UI-09).
  const isLive = !!d && (d.status === "starting" || d.status === "running" || d.status === "stopping");
  const live = useLiveRun(id, isLive, simulate);
  const ended = live.ended?.status;
  React.useEffect(() => {
    if (!ended) return;
    void queryClient.invalidateQueries({ queryKey: ["run", id] });
    void queryClient.invalidateQueries({ queryKey: ["runs"] });
    if (ended === "completed") notify.success(`${id} finished`, "The verdict, results and HTML report are on this page.");
    if (ended === "aborted" && live.ended?.abortReason === "emergency_stop") notify.success(`${id} stopped`, "Every runner pod is gone. The run is aborted: Emergency stop.");
  }, [ended, id, queryClient, live.ended?.abortReason]);
  async function emergencyStop() {
    const res = await fetch(`/api/runs/${encodeURIComponent(id)}/stop`, { method: "POST" });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).reason ?? "The stop request did not reach the platform. Try again.");
    // Done when the live stream reports the run over (pods gone), within the 30 s target plus margin.
    const final = await Promise.race([live.waitForEnd(), new Promise<null>((r) => setTimeout(() => r(null), 45_000))]);
    if (!final) throw new Error("The pods haven't confirmed the stop yet. Check the run in a moment, or try again.");
  }

  // A queued run hasn't sent load: Stop takes it out of the queue (back to approved).
  const dequeue = useMutation({
    mutationFn: () => request<RunDetail>(`/api/runs/${encodeURIComponent(id)}/stop`, { method: "POST" }),
    onSuccess: (detail) => {
      queryClient.setQueryData(["run", id, simulate], detail);
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
      notify.success(detail.status === "approved" ? `${id} removed from the queue` : `${id} is stopping`, detail.status === "approved" ? "No load was sent. Start it again when you're ready." : "It started meanwhile, so it got the emergency stop.");
    },
    onError: (error) => notify.error("Couldn't remove it from the queue", error instanceof RunError ? error.body.reason : "Try again."),
  });

  const pinBaseline = useMutation({
    mutationFn: () => request<RunDetail>(`/api/runs/${encodeURIComponent(id)}/baseline`, { method: "POST" }),
    onSuccess: (detail) => {
      queryClient.setQueryData(["run", id, simulate], detail);
      notify.success(`${id} is the baseline`, `Later ${detail.scenario.name} · ${PRESET_LABEL[detail.preset]} runs on ${detail.target.name} compare against it.`);
    },
    onError: (error) => notify.error("Couldn't set the baseline", error instanceof RunError ? error.body.reason : "Try again."),
  });

  const canEdit = canAct && !!d?.editable;
  const canStart = canAct && d?.status === "approved";
  const header = (
    <PageShell
      backHref="/runs"
      backLabel="Back to runs"
      title={id}
      titleAside={
        d ? (
          <span className="flex items-center gap-1.5">
            <RunStatusBadge status={d.status} />
            {d.baseline?.isThis ? (
              <Badge tone="info" className="max-sm:hidden">
                <Pin />
                Baseline
              </Badge>
            ) : null}
          </span>
        ) : null
      }
      subtitle={d ? `${d.scenario.name} v${d.scenario.version} · ${d.target.name} · ${ENVIRONMENT_LABEL[d.environment]}` : "Run detail"}
      actions={
        isLive && canAct ? (
          <EmergencyStop runId={id} load={live.samples.at(-1) ? { vus: live.samples.at(-1)!.vus, rps: live.samples.at(-1)!.rps } : undefined} onConfirm={emergencyStop} />
        ) : d?.status === "queued" && canAct ? (
          <Button size="sm" variant="outline" icon={<ListX />} aria-label="Remove from queue" loading={dequeue.isPending} onClick={() => dequeue.mutate()} className="max-sm:w-8 max-sm:px-0">
            <span className="max-sm:sr-only">Remove from queue</span>
          </Button>
        ) : d && (canEdit || canStart) ? (
          <>
            {/* Phones: icon-only, the label stays for screen readers. */}
            {canEdit ? (
              <Button size="sm" variant="outline" icon={<Pencil />} aria-label="Edit run" onClick={() => setEditing(true)} className="max-sm:w-8 max-sm:px-0">
                <span className="max-sm:sr-only">Edit</span>
              </Button>
            ) : null}
            {canStart ? (
              <Button size="sm" icon={<Play />} aria-label="Start run" loading={start.isPending} disabled={!d.start.ok} onClick={() => start.mutate()} className="max-sm:w-8 max-sm:px-0">
                <span className="max-sm:sr-only">Start</span>
              </Button>
            ) : null}
          </>
        ) : d && (d.grafanaUrl || d.results || d.canBaseline) ? (
          <>
            {/* Finished runs: investigate in Grafana, share the report, pin as baseline. */}
            {d.grafanaUrl ? (
              <Button asChild size="sm" variant="outline" className="max-sm:w-8 max-sm:px-0">
                <a href={d.grafanaUrl} target="_blank" rel="noopener noreferrer" aria-label="Open in Grafana">
                  <ExternalLink />
                  <span className="max-sm:sr-only">Grafana</span>
                </a>
              </Button>
            ) : null}
            {d.results ? (
              // The self-contained HTML report (UI-11); it has its own Download HTML / Download PDF buttons.
              <Button asChild size="sm" variant="outline" className="max-sm:w-8 max-sm:px-0">
                <a href={`/api/runs/${encodeURIComponent(d.id)}/report`} target="_blank" rel="noopener" aria-label="Open the HTML report">
                  <FileText />
                  <span className="max-sm:sr-only">Report</span>
                </a>
              </Button>
            ) : null}
            {canAct && d.canBaseline && !d.baseline?.isThis ? (
              <Button size="sm" icon={<Pin />} loading={pinBaseline.isPending} onClick={() => pinBaseline.mutate()} aria-label="Set as baseline" className="max-sm:w-8 max-sm:px-0">
                <span className="max-sm:sr-only">Set as baseline</span>
              </Button>
            ) : null}
          </>
        ) : null
      }
    />
  );
  const back = (
    <Button asChild size="sm" variant="outline">
      <Link href="/runs">
        <LinkPending>
          <ArrowLeft />
        </LinkPending>
        Back to runs
      </Link>
    </Button>
  );

  if (query.isError && !d) {
    const status = query.error instanceof RunError ? query.error.status : 0;
    return (
      <>
        {header}
        <PageBody>
          {status === 404 ? (
            <EmptyState icon={<SearchX />} title={`${id} doesn't exist`} description="Check the run ID, or find the run in the Runs list." action={back} />
          ) : status === 403 ? (
            <EmptyState icon={<Lock />} title="You don't have access to this run" description="Ask a Benchmark admin for access to its project." action={back} />
          ) : (
            <EmptyState
              icon={<TriangleAlert />}
              title="Couldn't load this run"
              description="The run service didn't answer. The run itself is safe; try again in a moment."
              action={<Button size="sm" variant="outline" icon={<RotateCw />} loading={query.isRefetching} onClick={() => query.refetch()}>Try again</Button>}
            />
          )}
        </PageBody>
      </>
    );
  }

  if (!d) {
    return (
      <>
        {header}
        <PageBody>
          <DetailSkeleton />
        </PageBody>
      </>
    );
  }

  const callout = statusCallout(d, now);
  const voids = d.approvalsRequired ? d.approvalRecords.length : 0;
  const expired = !!d.approvalExpiresAt && new Date(d.approvalExpiresAt) < now;
  const started = IN_FLIGHT.includes(d.status) && d.status !== "queued" ? true : !!d.startedAt;

  return (
    <>
      {header}
      <PageBody className="grid gap-5">
        {isLive ? <LiveRunPanel live={live} canStop={canAct} /> : null}
        {/* Status: where it stands and what's next (badge, Edit and Start sit in the header). */}
        <section aria-label="Status" className="grid gap-4 rounded-lg border border-border bg-card p-5">
          {/* A completed run's verdict banner (below) is its headline, so the callout would only repeat it. */}
          {d.status === "completed" && d.results ? null : (
            <div role="status" className={cn("flex items-start gap-2.5 rounded-lg border px-3.5 py-3", TONE_BOX[callout.tone])}>
              <span className="mt-0.5 shrink-0 [&_svg]:size-4">{TONE_ICON[callout.tone]}</span>
              <div className="min-w-0">
                <div className="text-sm font-semibold">{callout.title}</div>
                <p className="mt-0.5 text-xs text-foreground/80">{callout.text}</p>
              </div>
            </div>
          )}

          <dl className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4">
            <Fact label="Preset">{PRESET_LABEL[d.preset]}</Fact>
            <Fact label="Load">{d.load ? `${d.load.value.toLocaleString("en-US")} ${d.load.unit}` : "—"}</Fact>
            <Fact label="Duration">{formatDuration(d.durationSec * 1000)}</Fact>
            <Fact label="Network">{d.network ? NETWORK_PROFILES[d.network].label : "Protocol only"}</Fact>
            <Fact label="Release ID">{d.releaseId ? <span className="font-mono text-xs">{d.releaseId}</span> : <span className="text-muted-foreground">—</span>}</Fact>
            <Fact label="Created">
              <Hint label={when(d.createdAt)}><span>{relativeTime(new Date(d.createdAt), now)}</span></Hint>
              <span className="text-muted-foreground"> · {d.createdBy.name}</span>
            </Fact>
            <Fact label="Started">{d.startedAt ? <Hint label={when(d.startedAt)}><span>{relativeTime(new Date(d.startedAt), now)}</span></Hint> : <span className="text-muted-foreground">—</span>}</Fact>
            <Fact label="Ended">{d.endedAt ? <Hint label={when(d.endedAt)}><span>{relativeTime(new Date(d.endedAt), now)}</span></Hint> : <span className="text-muted-foreground">—</span>}</Fact>
          </dl>
        </section>

        <RunResultsSection d={d} now={now} />

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid min-w-0 grid-cols-1 gap-5">
            <Card title="Timeline">
              <ol className="grid">
                {d.timeline.map((e, i) => (
                  <li key={`${e.at}-${e.label}-${i}`} className="relative grid grid-cols-[16px_minmax(0,1fr)_auto] gap-x-3 pb-4 last:pb-0">
                    {i < d.timeline.length - 1 ? <span aria-hidden className="absolute top-4 bottom-0 left-[7px] w-px bg-border" /> : null}
                    <span aria-hidden className={cn("relative mt-1 size-[9px] justify-self-center rounded-full ring-4 ring-card", TONE_DOT[e.tone])} />
                    <div className="min-w-0">
                      <div className={cn("text-sm font-medium", e.tone === "danger" && "text-danger")}>{e.label}</div>
                      {e.by || e.note ? (
                        <p className="text-xs text-muted-foreground">
                          {e.by ? `by ${e.by}` : ""}
                          {e.by && e.note ? " · " : ""}
                          {e.note}
                        </p>
                      ) : null}
                    </div>
                    <Hint label={`${when(e.at)} · ${relativeTime(new Date(e.at), now)}`} side="left">
                      <time dateTime={e.at} className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                        {eventTime(e.at, now)}
                      </time>
                    </Hint>
                  </li>
                ))}
              </ol>
            </Card>

            <Card
              title="Preflight"
              aside={d.preflight ? null : <span className="text-xs text-muted-foreground">Runs when you press Start</span>}
            >
              <PreflightChecklist results={d.preflight ?? {}} />
              <p className="mt-3 text-xs text-muted-foreground">Any failed check blocks the start and names the check. Policy and approvals are checked again at the same time.</p>
            </Card>

            <Card title="Manifest" aside={<HashDisplay hash={d.manifestHash} />}>
              <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed text-foreground">{JSON.stringify(d.manifest, null, 2)}</pre>
              <p className="mt-3 text-xs text-muted-foreground">Approvals bind to this SHA-256 hash. Each runner pod recomputes it before sending load.</p>
            </Card>

            <Card title="Versions">
              <dl className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-3">
                <Fact label="Web app">{version(d.versions.web)}</Fact>
                <Fact label="Worker">{version(d.versions.worker)}</Fact>
                <Fact label="Runner image">{version(d.versions.runner)}</Fact>
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">The web app that created this run, the worker that started it and the runner image it ran.</p>
            </Card>
          </div>

          <div className="grid min-w-0 grid-cols-1 content-start gap-5">
            <Card
              title="Approvals"
              aside={
                d.status === "draft" ? (
                  <Badge>Not submitted</Badge>
                ) : (
                  <Badge tone={d.approvalsRequired === 0 || d.approvalRecords.length >= d.approvalsRequired ? "success" : "warning"}>
                    {d.approvalsRequired === 0 ? "Auto" : `${d.approvalRecords.length} of ${d.approvalsRequired}`}
                  </Badge>
                )
              }
            >
              <ul className="grid gap-3">
                {d.approvalRecords.map((a) => (
                  <li key={a.by + a.at} className="flex items-start gap-2.5">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-success-soft text-success [&_svg]:size-3.5">
                      {a.rule ? <CircleCheck /> : <UserRound />}
                    </span>
                    <div className="min-w-0 text-xs">
                      <div className="text-sm font-medium">{a.rule ? "Auto-approved by policy" : a.by}</div>
                      {a.rule ? <div className="text-muted-foreground">{a.rule}</div> : null}
                      <div className="text-muted-foreground">
                        <Hint label={when(a.at)}>
                          <span>{relativeTime(new Date(a.at), now)}</span>
                        </Hint>
                        {started ? "" : new Date(a.expiresAt) < now ? " · expired" : ` · valid until ${when(a.expiresAt)}`}
                      </div>
                    </div>
                  </li>
                ))}
                {d.status === "pending_approval" || d.status === "draft"
                  ? Array.from({ length: Math.max(0, d.approvalsRequired - d.approvalRecords.length) }, (_, i) => (
                      <li key={`waiting-${i}`} className="flex items-center gap-2.5">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed border-border-strong text-muted-foreground [&_svg]:size-3.5">
                          <Clock />
                        </span>
                        <span className="text-sm text-muted-foreground">Waiting for an approver</span>
                      </li>
                    ))
                  : null}
                {d.status === "rejected" ? <li className="text-sm text-danger">Rejected. Create a new run with a different plan.</li> : null}
                {d.status === "draft" && d.approvalsRequired === 0 ? <li className="text-sm text-muted-foreground">Policy approves it as soon as it&apos;s submitted.</li> : null}
              </ul>
              <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
                {d.approvalsRequired === 0
                  ? "Smoke, baseline and peak on staging are approved by policy."
                  : d.approvalsRequired === 2
                    ? "Prod-like runs need 2 different approvers."
                    : "Spike, stress and soak need 1 approver."}{" "}
                The starter can&apos;t approve, and any edit voids earlier approvals.
                {expired && d.status === "approved" ? " These approvals have expired." : ""}
              </p>
            </Card>

            <Card title="Logs and artifacts">
              <div className="grid grid-cols-1 gap-3">
                {d.logsUrl ? (
                  <Button asChild variant="outline" size="sm" className="w-full">
                    <a href={d.logsUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink />
                      Open logs in CloudWatch
                    </a>
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">Logs appear once the runner pods start.</p>
                )}
                {d.artifacts.length ? (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {d.artifacts.map((a) => (
                      <li key={a.name} className="flex items-center gap-1 py-1 pr-1 pl-1">
                        <button
                          type="button"
                          disabled={!canPreview(a)}
                          onClick={() => setViewing(a)}
                          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1 text-left enabled:hover:bg-muted disabled:cursor-default"
                          aria-label={canPreview(a) ? `View ${a.label}` : undefined}
                        >
                          {a.contentType.startsWith("image/") ? (
                            <FileImage className="size-4 shrink-0 text-muted-foreground" />
                          ) : a.contentType.includes("json") ? (
                            <FileJson className="size-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <FileText className="size-4 shrink-0 text-muted-foreground" />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm">{a.label}</span>
                            <Hint label={a.name} side="bottom">
                              <span className="block truncate font-mono text-micro text-muted-foreground">
                                {a.name} · {(a.sizeBytes / 1000).toFixed(1)} KB
                              </span>
                            </Hint>
                          </span>
                          {canPreview(a) ? <Eye className="size-4 shrink-0 text-muted-foreground" /> : null}
                        </button>
                        <DownloadButton runId={d.id} artifact={a} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {d.status === "failed" ? "No artifacts: the run never sent load." : "Summary, screenshots and browser errors are saved when the run ends (kept 90 days)."}
                  </p>
                )}
              </div>
            </Card>
          </div>
        </div>
      </PageBody>

      {viewing ? <ArtifactViewer runId={d.id} artifacts={d.artifacts} artifact={viewing} onClose={() => setViewing(undefined)} /> : null}

      {editing ? (
        <CreateRunForm
         
          catalog={catalog}
          projectName={d.projectName}
          initial={{
            scenario: d.scenario.name,
            version: d.scenario.version,
            environment: d.environment,
            target: d.target.id,
            preset: d.preset,
            network: d.network ?? "stadium-4g",
            releaseId: d.releaseId,
          }}
          edit={{
            runId: d.id,
            voids,
            onClose: () => setEditing(false),
            onSaved: (detail) => {
              queryClient.setQueryData(["run", id, simulate], detail);
              setEditing(false);
            },
          }}
        />
      ) : null}
    </>
  );
}
