"use client";

import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import { dayLabel, relativeTime } from "@/lib/time";
import { ABORT_LABEL, CAVEAT_LABEL, PRESET_LABEL, type RunListItem } from "@/lib/runs/types";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RunStatusBadge } from "@/components/btb/run-status-badge";
import { Spinner } from "@/components/ui/button";
import { useNavigate } from "@/components/navigation";
import { Hint } from "@/components/ui/tooltip";

/** One line of context under the status: approvals, abort reason or system failure. */
function statusNote(run: RunListItem) {
  if (run.status === "pending_approval" && run.approvals) return `${run.approvals.approved} of ${run.approvals.required} approvals`;
  if (run.status === "aborted" && run.abortReason) return ABORT_LABEL[run.abortReason];
  if (run.status === "failed") return "System error, no verdict";
  if (run.status === "draft") return "Not submitted";
  return null;
}

function Verdict({ run }: { run: RunListItem }) {
  if (!run.verdict) return <span className="text-muted-foreground">—</span>;
  const pass = run.verdict.result === "pass";
  const caveats = run.verdict.caveats;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Badge tone={pass ? "success" : "danger"} dot>{pass ? "Pass" : "Fail"}</Badge>
      {caveats.length ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="cursor-help rounded text-xs text-warning underline decoration-dotted underline-offset-2 outline-none focus-visible:shadow-focus">
              +{caveats.length} {caveats.length === 1 ? "caveat" : "caveats"}
            </button>
          </TooltipTrigger>
          <TooltipContent>{caveats.map((c) => CAVEAT_LABEL[c]).join(" · ")}</TooltipContent>
        </Tooltip>
      ) : null}
    </span>
  );
}

function When({ run, now }: { run: RunListItem; now: Date }) {
  const at = new Date(run.createdAt);
  return (
    <div className="leading-tight">
      <Hint label={at.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} side="top">
        <div className="w-fit text-sm whitespace-nowrap">{relativeTime(at, now)}</div>
      </Hint>
      <div className="truncate text-xs text-muted-foreground">by {run.createdBy.name}</div>
    </div>
  );
}

/** Runs grouped by the day they were created, newest first (the order the API returns). */
function groupByDay(runs: RunListItem[], now: Date) {
  const groups: { label: string; runs: RunListItem[] }[] = [];
  for (const run of runs) {
    const label = dayLabel(new Date(run.createdAt), now);
    const last = groups.at(-1);
    if (last?.label === label) last.runs.push(run);
    else groups.push({ label, runs: [run] });
  }
  return groups;
}

export function RunHistory({ runs, now, highlightId }: { runs: RunListItem[]; now: Date; highlightId?: string }) {
  const nav = useNavigate();
  const [opening, setOpening] = React.useState<string | null>(null);
  const groups = groupByDay(runs, now);
  const open = (run: RunListItem) => {
    setOpening(run.id);
    nav.push(`/runs/${run.id}`);
  };
  // Link clicks take the same path as row clicks (so the row knows it's opening); Ctrl/Cmd-click still opens a tab.
  const openFromLink = (e: React.MouseEvent, run: RunListItem) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    open(run);
  };
  const isOpening = (run: RunListItem) => nav.pending && opening === run.id;
  // Where the eye lands at the end of the row: replaces the time while the run opens.
  const openingLabel = (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap text-info">
      <Spinner className="size-3.5" />
      Opening…
    </span>
  );

  return (
    <>
      {/* Desktop: one table, day groups as section rows (density shift against the airy band above). */}
      <div className="overflow-hidden rounded-lg border border-border bg-card max-md:hidden">
        <Table aria-label="Run history">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Run</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Verdict</TableHead>
              {/* Below 2xl (rail open beside the card) release moves under the target so the table fits. */}
              <TableHead className="max-2xl:hidden">Release</TableHead>
              <TableHead>When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((g) => (
              <React.Fragment key={g.label}>
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="bg-background py-2 text-label font-semibold tracking-wide text-muted-foreground uppercase">
                    {g.label}
                  </TableCell>
                </TableRow>
                {g.runs.map((run) => {
                  const note = statusNote(run);
                  return (
                    <TableRow
                      key={run.id}
                      onClick={(e) => {
                        if (!(e.target as HTMLElement).closest("a,button")) open(run);
                      }}
                      data-run-id={run.id}
                      aria-busy={isOpening(run) || undefined}
                      className={cn(
                        "cursor-pointer",
                        run.id === highlightId && "animate-flash motion-reduce:animate-none",
                        // The clicked row: tinted, its content dimmed, "Opening…" in the last cell.
                        isOpening(run) && "bg-info-soft hover:bg-info-soft [&>td:not(:last-child)]:opacity-50",
                      )}
                    >
                      <TableCell>
                        <Link
                          href={`/runs/${run.id}`}
                          onClick={(e) => openFromLink(e, run)}
                          className="grid rounded leading-tight no-underline outline-none focus-visible:shadow-focus"
                        >
                          <span className="text-xs text-muted-foreground">
                            <span className="font-mono">{run.id}</span> · {PRESET_LABEL[run.preset]}
                          </span>
                          <span className="font-medium text-foreground">
                            {run.scenario.name} <span className="font-normal text-muted-foreground">v{run.scenario.version}</span>
                          </span>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div className="leading-tight">
                          <div>{run.target.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {run.environment}
                            {run.releaseId ? <span className="2xl:hidden"> · <span className="font-mono">{run.releaseId}</span></span> : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="grid justify-items-start gap-0.5">
                          <RunStatusBadge status={run.status} />
                          {note ? <span className="text-micro text-muted-foreground">{note}</span> : null}
                        </div>
                      </TableCell>
                      <TableCell><Verdict run={run} /></TableCell>
                      <TableCell className="max-2xl:hidden">
                        {run.releaseId ? <span className="font-mono text-xs">{run.releaseId}</span> : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>{isOpening(run) ? openingLabel : <When run={run} now={now} />}</TableCell>
                    </TableRow>
                  );
                })}
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Phones: the same runs as stacked rows; a seven-column table does not fit 390px. */}
      <div className="grid gap-4 md:hidden">
        {groups.map((g) => (
          <section key={g.label} aria-label={g.label}>
            <h3 className="mb-2 text-label font-semibold tracking-wide text-muted-foreground uppercase">{g.label}</h3>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {g.runs.map((run) => {
                const note = statusNote(run);
                return (
                  <li
                    key={run.id}
                    data-run-id={run.id}
                    aria-busy={isOpening(run) || undefined}
                    className={cn(run.id === highlightId && "animate-flash motion-reduce:animate-none", isOpening(run) && "bg-info-soft")}
                  >
                    <Link
                      href={`/runs/${run.id}`}
                      onClick={(e) => openFromLink(e, run)}
                      className={cn(
                        "grid gap-1.5 px-4 py-3 text-foreground no-underline outline-none focus-visible:bg-muted active:bg-muted",
                        isOpening(run) && "active:bg-transparent [&>div:not(:last-child)]:opacity-50",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{run.id}</span>
                        <RunStatusBadge status={run.status} />
                      </div>
                      <div className="text-sm font-medium">
                        {run.scenario.name} <span className="font-normal text-muted-foreground">v{run.scenario.version} · {PRESET_LABEL[run.preset]}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {run.target.name} · {run.environment}
                        {run.releaseId ? <> · <span className="font-mono">{run.releaseId}</span></> : null}
                        {note ? <> · {note}</> : null}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <Verdict run={run} />
                        {isOpening(run) ? (
                          openingLabel
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {relativeTime(new Date(run.createdAt), now)} · {run.createdBy.name}
                          </span>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
