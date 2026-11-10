"use client";

import * as React from "react";
import { Clock, OctagonX } from "lucide-react";

import { cn } from "@/lib/utils";
import { clock } from "@/lib/time";
import { useNow } from "@/lib/use-now";
import type { LivePlan, LiveSample } from "@btb/contracts";
import type { RunStatus } from "@/lib/run-status";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/button";
import { LiveMetricChart } from "@/components/btb/live-metric-chart";
import { ThresholdMetricCard } from "@/components/btb/threshold-metric-card";

/** No update for this long = "Data delayed" (updates come every 5 s). */
const STALE_MS = 12_000;

export interface LiveState {
  status?: RunStatus;
  startedAt?: string | null;
  durationSec: number;
  elapsedSec: number;
  plan?: LivePlan;
  thresholds?: { p95Ms: number; errorRatePct: number } | null;
  samples: LiveSample[];
  /** When the last update arrived (client clock). */
  lastAt: number;
  ended?: { status: RunStatus; abortReason: string | null };
}

/**
 * Follows /api/runs/[id]/live (SSE, every 5 s). EventSource reconnects by itself; while it can't, `stale` turns
 * on. `waitForEnd` resolves with the final status (used by Emergency stop to know the pods are gone).
 */
export function useLiveRun(id: string, enabled: boolean, simulate?: string | null) {
  const [state, setState] = React.useState<LiveState>({ durationSec: 0, elapsedSec: 0, samples: [], lastAt: 0 });
  const [openedAt, setOpenedAt] = React.useState(0);
  const waiters = React.useRef<((status: RunStatus) => void)[]>([]);
  const now = useNow(1000);

  React.useEffect(() => {
    if (!enabled) return;
    setOpenedAt(Date.now());
    const es = new EventSource(`/api/runs/${encodeURIComponent(id)}/live${simulate ? `?simulate=${simulate}` : ""}`);
    const take = (e: Event, replace: boolean) => {
      const p = JSON.parse((e as MessageEvent).data) as Omit<LiveState, "lastAt">;
      setState((prev) => ({ ...prev, ...p, samples: replace ? p.samples : [...prev.samples, ...p.samples].slice(-180), lastAt: Date.now() }));
    };
    es.addEventListener("snapshot", (e) => take(e, true));
    es.addEventListener("tick", (e) => take(e, false));
    es.addEventListener("end", (e) => {
      const ended = JSON.parse((e as MessageEvent).data) as LiveState["ended"] & {};
      setState((prev) => ({ ...prev, status: ended.status, ended, lastAt: Date.now() }));
      waiters.current.splice(0).forEach((w) => w(ended.status));
      es.close();
    });
    return () => es.close();
  }, [id, enabled, simulate]);

  const since = state.lastAt || openedAt;
  const stale = enabled && !state.ended && since > 0 && now.getTime() - since > STALE_MS;
  // Between updates the clock keeps going, so time remaining counts down every second.
  const running = state.status === "running" || state.status === "stopping";
  const elapsed = Math.min(state.durationSec, state.elapsedSec + (running && state.lastAt && !stale ? (now.getTime() - state.lastAt) / 1000 : 0));
  const waitForEnd = React.useCallback(() => new Promise<RunStatus>((resolve) => waiters.current.push(resolve)), []);
  return { ...state, stale, elapsed, waitForEnd, connected: state.lastAt > 0 };
}

const fmt = (n: number) => n.toLocaleString("en-US");

/** UI-09 live view: progress and time left, the five live numbers against thresholds, and their charts. */
export function LiveRunPanel({ live, canStop }: { live: ReturnType<typeof useLiveRun>; canStop: boolean }) {
  const now = useNow(1000);
  const last = live.samples.at(-1);
  const t = live.thresholds;
  const pct = live.durationSec ? Math.min(100, (live.elapsed / live.durationSec) * 100) : 0;
  const points = (pick: (s: LiveSample) => number) => live.samples.map((s) => ({ t: clock(s.elapsedSec), value: pick(s) }));

  return (
    <section aria-label="Live run" className="grid gap-4">
      <div className="grid gap-4 rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Live</h2>
            {live.stale ? (
              <Badge tone="warning">
                <Clock />
                Data delayed
              </Badge>
            ) : live.connected ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span aria-hidden className="size-1.5 animate-live-pulse rounded-full bg-success motion-reduce:animate-none" />
                Updated {Math.max(0, Math.round((now.getTime() - live.lastAt) / 1000))} s ago
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Spinner className="size-3" />
                Connecting
              </span>
            )}
          </div>
          {live.status === "running" || live.status === "stopping" ? (
            <div className="text-right font-mono text-sm tabular-nums">
              {clock(live.elapsed)} <span className="text-muted-foreground">/ {clock(live.durationSec)}</span>
              <span className="ml-3 font-sans text-xs text-muted-foreground">{clock(Math.max(0, live.durationSec - live.elapsed))} left</span>
            </div>
          ) : null}
        </div>

        {live.status === "starting" ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            Runner pods are starting. Load begins when every pod has verified the plan and taken its lease.
          </p>
        ) : (
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Run progress" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
            <div className={cn("h-full rounded-full transition-[width] duration-1000 ease-linear", live.status === "stopping" ? "bg-danger" : "bg-brand")} style={{ width: `${pct}%` }} />
          </div>
        )}

        {live.status === "stopping" ? (
          <p role="status" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
            <OctagonX className="mt-px size-3.5 shrink-0" />
            Emergency stop: the TestRun is deleted and the runner pods are shutting down.
          </p>
        ) : null}
        {live.stale ? (
          <p className="text-xs text-warning">
            No update for {Math.round((now.getTime() - (live.lastAt || now.getTime())) / 1000)} s. The run keeps its own safety limits{canStop ? ", and Emergency stop still works" : ""}.
          </p>
        ) : null}
        {!canStop ? <p className="text-xs text-muted-foreground">Only engineers and above can stop a run.</p> : null}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <ThresholdMetricCard label="Virtual users" value={last ? fmt(last.vus) : "—"} unit={live.plan?.model === "vus" ? `/ ${fmt(live.plan.load)}` : undefined} />
        <ThresholdMetricCard label="Requests / s" value={last ? fmt(last.rps) : "—"} unit={live.plan?.model === "rps" ? `/ ${fmt(live.plan.load)}` : undefined} />
        <ThresholdMetricCard label="p95 latency" value={last ? fmt(last.p95Ms) : "—"} unit="ms" threshold={t ? `≤ ${t.p95Ms} ms` : undefined} pass={last && t ? last.p95Ms <= t.p95Ms : undefined} />
        <ThresholdMetricCard label="p99 latency" value={last ? fmt(last.p99Ms) : "—"} unit="ms" />
        <ThresholdMetricCard label="Error rate" value={last ? String(last.errorRatePct) : "—"} unit="%" threshold={t ? `≤ ${t.errorRatePct}%` : undefined} pass={last && t ? last.errorRatePct <= t.errorRatePct : undefined} className="max-xl:col-span-2 max-md:col-span-2 md:max-xl:col-span-1" />
      </div>

      {live.samples.length ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <LiveMetricChart title="p95 latency" unit="ms" data={points((s) => s.p95Ms)} threshold={t?.p95Ms} stale={live.stale} />
          <LiveMetricChart title="Error rate" unit="%" data={points((s) => s.errorRatePct)} threshold={t?.errorRatePct} stale={live.stale} />
          <LiveMetricChart title="Virtual users" unit="VUs" data={points((s) => s.vus)} stale={live.stale} />
          <LiveMetricChart title="Requests per second" unit="RPS" data={points((s) => s.rps)} stale={live.stale} />
        </div>
      ) : null}
    </section>
  );
}
