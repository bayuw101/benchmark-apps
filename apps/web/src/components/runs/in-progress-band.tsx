"use client";

import * as React from "react";
import Link from "next/link";
import { Activity, ChevronDown, Gauge } from "lucide-react";

import { cn } from "@/lib/utils";
import { clock } from "@/lib/time";
import { useNow } from "@/lib/use-now";
import { PRESET_LABEL, type RunListItem } from "@/lib/runs/types";
import { Skeleton } from "@/components/ui/skeleton";
import { RunStatusBadge } from "@/components/btb/run-status-badge";
import { ShellAside } from "@/components/arbiter/shell-aside";
import { LinkPending } from "@/components/arbiter/link-pending";
import { PAGE_WIDTH } from "@/components/arbiter/page-shell";

// Full class names (Tailwind only generates classes it can see in the source).
const TONE = {
  success: { text: "text-success", bar: "bg-success" },
  warning: { text: "text-warning", bar: "bg-warning" },
  danger: { text: "text-danger", bar: "bg-danger" },
} as const;

const cardClass =
  "group grid content-start gap-3 rounded-lg border border-border bg-card p-4 text-foreground no-underline shadow-sm transition-[border-color,transform] duration-150 outline-none hover:border-border-strong focus-visible:shadow-focus";

function Head({ run }: { run: RunListItem }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
          {run.id}
          <LinkPending className="size-3" />
        </div>
        <div className="truncate text-sm font-semibold">
          {run.scenario.name}{" "}
          <span className="font-normal text-muted-foreground">
            v{run.scenario.version} · {PRESET_LABEL[run.preset]}
          </span>
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {run.target.name} · {run.environment}
        </div>
      </div>
      <RunStatusBadge status={run.status} />
    </div>
  );
}

function ActiveCard({
  run,
  now,
  wide,
}: {
  run: RunListItem;
  now: Date;
  wide?: boolean;
}) {
  const elapsed = run.startedAt
    ? (now.getTime() - new Date(run.startedAt).getTime()) / 1000
    : 0;
  const pct = Math.min(100, (elapsed / run.durationSec) * 100);
  const live = run.live;
  const ratio = live ? live.p95Ms / live.thresholdMs : 0;
  const tone =
    TONE[ratio >= 1 ? "danger" : ratio >= 0.9 ? "warning" : "success"];
  return (
    <Link
      href={`/runs/${run.id}`}
      className={cn(cardClass, wide && "md:col-span-2")}
      aria-label={`${run.id}, ${run.scenario.name}, ${run.status}`}
    >
      <Head run={run} />
      {run.startedAt ? (
        <div className="grid gap-1.5">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-mono font-medium tabular-nums">
              {clock(elapsed)}{" "}
              <span className="text-muted-foreground">
                / {clock(run.durationSec)}
              </span>
            </span>
            <span className="text-muted-foreground">
              {clock(run.durationSec - elapsed)} left
            </span>
          </div>
          {/* The page's one accent moment: progress in brand blue. */}
          <div
            className="h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Run progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
          >
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-1000 ease-linear"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">
          Runner pods are starting. Load begins when every pod has verified the
          plan.
        </div>
      )}
      {live ? (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-4 gap-y-1">
          <div className="text-xs text-muted-foreground">
            p95{" "}
            <span
              className={cn("text-base font-semibold tabular-nums", tone.text)}
            >
              {live.p95Ms}
            </span>{" "}
            ms
            <span className="whitespace-nowrap text-muted-foreground">
              {" "}
              / threshold {live.thresholdMs}
            </span>
          </div>
          <div className="text-right text-xs text-muted-foreground tabular-nums">
            {live.vus.toLocaleString("en-US")} VUs ·{" "}
            {live.rps.toLocaleString("en-US")} RPS
          </div>
          <div className="col-span-2 h-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full", tone.bar)}
              style={{ width: `${Math.min(100, ratio * 100)}%` }}
            />
          </div>
        </div>
      ) : null}
    </Link>
  );
}

function QueuedCard({ run }: { run: RunListItem }) {
  const q = run.queue;
  return (
    <Link
      href={`/runs/${run.id}`}
      className={cardClass}
      aria-label={`${run.id}, queued`}
    >
      <Head run={run} />
      {q ? (
        <div className="text-xs text-muted-foreground">
          <span className="text-sm font-semibold text-foreground">
            #{q.position} in queue
          </span>
          <br />
          Waiting for{" "}
          <span className="font-mono text-foreground">
            {q.blockedBy}
          </span> ·{" "}
          {q.scope === "target"
            ? "1 active run per target"
            : "2 active runs per namespace"}
          . Starts by itself.
        </div>
      ) : null}
    </Link>
  );
}

/** Active runs first, then queued ones. */
const ordered = (runs: RunListItem[]) => [
  ...runs.filter((r) => r.status !== "queued"),
  ...runs.filter((r) => r.status === "queued"),
];

function runSummary(runs: RunListItem[]) {
  const queued = runs.filter((run) => run.status === "queued").length;
  const active = runs.length - queued;
  return runs.length
    ? [active && `${active} active`, queued && `${queued} queued`].filter(Boolean).join(" · ")
    : "No active runs";
}

/**
 * Below xl: in-flight runs as a `shell`-coloured band at the top of the page (gray in light, near-black
 * in dark), bleeding to the content card's edges. Running cards are twice as wide as queued ones.
 * On phones the band can be collapsed to its heading plus a one-line summary, so history is one tap away.
 */
export function InProgressBand({
  runs,
  loading,
}: {
  runs: RunListItem[];
  loading?: boolean;
}) {
  const now = useNow(1000);
  // not remembered across visits; keep it in localStorage if people ask for it.
  const [open, setOpen] = React.useState(true);
  const summary = runSummary(runs);
  return (
    <section
      aria-labelledby="in-progress-band-title"
      className="border-b border-border bg-shell text-foreground xl:hidden"
    >
      <div
        className={cn(PAGE_WIDTH, "py-5", !open && "max-md:py-3")}
      >
        <div
          className={cn(
            "relative flex min-h-9 items-center gap-3",
            open ? "mb-3" : "max-md:mb-0 md:mb-3",
          )}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-sm">
            <Activity className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id="in-progress-band-title" className="text-sm font-semibold text-foreground">
              In progress
            </h2>
            {!loading ? <p className="truncate text-xs text-shell-muted">{summary}</p> : null}
          </div>
          {!loading && runs.some((run) => run.status !== "queued") ? (
            <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-xs text-shell-muted">
              <span aria-hidden className="size-1.5 animate-live-pulse rounded-full bg-success motion-reduce:animate-none" />
              Live
            </span>
          ) : null}
          <ChevronDown
            aria-hidden
            className={cn(
              "size-4 shrink-0 text-shell-muted transition-transform duration-150 md:hidden",
              !open && "-rotate-90",
            )}
          />
          {/* Phones only: the whole heading row is the toggle (the overlay button is gone from md up). */}
          <button
            type="button"
            aria-expanded={open}
            aria-controls="in-progress-band-body"
            aria-label={
              open ? "Collapse in-progress runs" : "Expand in-progress runs"
            }
            onClick={() => setOpen((o) => !o)}
            className="absolute -inset-2 rounded-md outline-none focus-visible:shadow-focus md:hidden"
          />
        </div>
        <div
          id="in-progress-band-body"
          className={cn(!open && "max-md:hidden")}
        >
          {loading ? (
            <div className="grid gap-3 md:grid-cols-3">
              <Skeleton className="h-40 bg-card md:col-span-2" />
              <Skeleton className="h-40 bg-card" />
            </div>
          ) : runs.length ? (
            // Active runs (wide) stack in the left two columns, queued ones fill the right column (dense packing).
            <div className="grid gap-3 md:grid-flow-row-dense md:grid-cols-3">
              {ordered(runs).map((r) =>
                r.status === "queued" ? (
                  <QueuedCard key={r.id} run={r} />
                ) : (
                  <ActiveCard key={r.id} run={r} now={now} wide />
                ),
              )}
            </div>
          ) : (
            <p className="text-sm text-shell-muted">
              Nothing running right now. Runs appear here live as soon as they
              start.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * From xl: the same runs in the shell's right-hand slot, outside the content card (where the AI panel
 * opens), pushing the card left. No panel surface: it sits straight on the shell gray like the nav, only
 * the run cards are raised.
 */
export function InProgressRail({
  runs,
  loading,
}: {
  runs: RunListItem[];
  loading?: boolean;
}) {
  const now = useNow(1000);
  return (
    <ShellAside>
      <aside
        aria-labelledby="in-progress-rail-title"
        className="flex h-full animate-slide-in flex-col text-foreground"
      >
        {/* 46px + slot padding + list padding puts the first card level with the content card's top. */}
        <div className="flex h-[46px] shrink-0 items-center gap-2 px-1">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-sm">
            <Activity className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id="in-progress-rail-title" className="text-sm font-semibold leading-4 text-foreground">
              In progress
            </h2>
            {!loading ? <p className="truncate text-xs leading-4 text-shell-muted">{runSummary(runs)}</p> : null}
          </div>
          {!loading && runs.some((run) => run.status !== "queued") ? (
            <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-xs text-shell-muted">
              <span aria-hidden className="size-1.5 animate-live-pulse rounded-full bg-success motion-reduce:animate-none" />
              Live
            </span>
          ) : null}
        </div>
        <div className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto p-1">
          {loading ? (
            <>
              <Skeleton className="h-44 bg-card" />
              <Skeleton className="h-32 bg-card" />
            </>
          ) : runs.length ? (
            ordered(runs).map((r) =>
              r.status === "queued" ? (
                <QueuedCard key={r.id} run={r} />
              ) : (
                <ActiveCard key={r.id} run={r} now={now} />
              ),
            )
          ) : (
            <div className="mt-10 grid justify-items-center gap-2 px-6 text-center">
              <span className="flex size-10 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-sm">
                <Gauge className="size-5" />
              </span>
              <div className="text-sm font-semibold">Nothing running</div>
              <p className="text-xs text-shell-muted">
                Runs appear here live as soon as they start.
              </p>
            </div>
          )}
        </div>
      </aside>
    </ShellAside>
  );
}
