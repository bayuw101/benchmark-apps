"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { ChevronRight, Clock, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDuration, relativeTime } from "@/lib/time";
import { useNow } from "@/lib/use-now";
import { ENVIRONMENT_LABEL } from "@btb/core/policy";
import { PRESET_LABEL, type RunDetail } from "@/lib/runs/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/arbiter/empty-state";
import { PageBody, PageShell } from "@/components/arbiter/page-shell";
import { Tabs } from "@/components/arbiter/tabs";
import { ReviewSheet, STATE_BADGE, type ReviewItem } from "./review-sheet";

const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

/** When the current version was put up for approval: the last submit or edit. */
function waitingSince(d: RunDetail) {
  const e = [...d.timeline].reverse().find((x) => x.label.startsWith("Submitted") || x.label === "Edited");
  return e?.at ?? d.createdAt;
}

/** Riskiest first (prod-like, then re-approvals), then the longest wait. */
function byPriority(a: ReviewItem, b: ReviewItem) {
  const rank = (i: ReviewItem) => (i.detail.environment === "prod-like" ? 0 : i.state === "expired" || i.state === "edited" ? 1 : 2);
  return rank(a) - rank(b) || waitingSince(a.detail).localeCompare(waitingSince(b.detail));
}

/** One circle per required approver: initials when given (red ring if expired), dashed when still open. */
function ApproverSlots({ d, now }: { d: RunDetail; now: Date }) {
  const slots = Array.from({ length: d.approvalsRequired }, (_, i) => d.approvalRecords[i]);
  return (
    <div className="flex items-center -space-x-1.5">
      {slots.map((a, i) =>
        a ? (
          <Tooltip key={i}>
            <TooltipTrigger asChild>
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-full border-2 border-card text-[10px] font-bold",
                  a.expiresAt < now.toISOString() ? "bg-danger-soft text-danger ring-1 ring-danger" : "bg-success-soft text-success",
                )}
              >
                {initials(a.by)}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {a.by} approved {relativeTime(new Date(a.at), now)}
              {a.expiresAt < now.toISOString() ? " (expired)" : ""}
            </TooltipContent>
          </Tooltip>
        ) : (
          <span key={i} aria-hidden className="size-7 rounded-full border-2 border-dashed border-border-strong bg-card" />
        ),
      )}
    </div>
  );
}

function Waited({ d, state, now }: { d: RunDetail; state: ReviewItem["state"]; now: Date }) {
  if (state === "expired" && d.approvalExpiresAt) {
    return <span className="text-xs font-medium text-danger">Expired {relativeTime(new Date(d.approvalExpiresAt), now)}</span>;
  }
  const since = waitingSince(d);
  const hours = (now.getTime() - new Date(since).getTime()) / 3_600_000;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", hours >= 8 ? "font-medium text-warning" : "text-muted-foreground")}>
      <Clock className="size-3" />
      {relativeTime(new Date(since), now).replace(" ago", "")}
    </span>
  );
}

function ReviewTable({ items, onOpen, now }: { items: ReviewItem[]; onOpen: (id: string) => void; now: Date }) {
  return (
    <>
      {/* Desktop: same table language as Run history. */}
      <div className="overflow-hidden rounded-lg border border-border bg-card max-md:hidden">
        <Table aria-label="Runs to review">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Run</TableHead>
              <TableHead>Load</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Approvals</TableHead>
              <TableHead>Waiting</TableHead>
              <TableHead className="w-28"><span className="sr-only">Action</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              const d = item.detail;
              const badge = STATE_BADGE[item.state];
              return (
                <TableRow key={d.id} className="cursor-pointer" onClick={(e) => !(e.target as HTMLElement).closest("button") && onOpen(d.id)}>
                  <TableCell>
                    <div className="grid gap-0.5 leading-tight">
                      <span className="text-xs text-muted-foreground">
                        <span className="font-mono">{d.id}</span> · by {d.createdBy.name}
                      </span>
                      <span className="font-medium">
                        {d.scenario.name} <span className="font-normal text-muted-foreground">v{d.scenario.version} · {PRESET_LABEL[d.preset]}</span>
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="leading-tight">
                      <div className="font-semibold tabular-nums">{d.load ? `${d.load.value.toLocaleString("en-US")} ${d.load.unit}` : "—"}</div>
                      <div className="text-xs text-muted-foreground">{formatDuration(d.durationSec * 1000)}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="grid justify-items-start gap-1 leading-tight">
                      <span className="font-mono text-xs">{d.target.name}</span>
                      <Badge tone={d.environment === "prod-like" ? "danger" : "neutral"}>{ENVIRONMENT_LABEL[d.environment]}</Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="grid justify-items-start gap-1">
                      <ApproverSlots d={d} now={now} />
                      <span className={cn("text-micro font-medium", badge.tone === "danger" ? "text-danger" : badge.tone === "info" ? "text-info" : "text-warning")}>{badge.label(d)}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Waited d={d} state={item.state} now={now} />
                  </TableCell>
                  <TableCell className="text-right">
                    {item.canApprove ? (
                      <Button size="sm" variant="outline" icon={<ChevronRight />} onClick={() => onOpen(d.id)} className="flex-row-reverse">
                        Review
                      </Button>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button size="sm" variant="ghost" icon={<ChevronRight />} onClick={() => onOpen(d.id)} className="flex-row-reverse">
                            View
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{item.reason}</TooltipContent>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Phones: one card per run, the same facts stacked. */}
      <ul className="grid gap-3 md:hidden">
        {items.map((item) => {
          const d = item.detail;
          const badge = STATE_BADGE[item.state];
          return (
            <li key={d.id}>
              <button type="button" onClick={() => onOpen(d.id)} className="grid w-full gap-3 rounded-lg border border-border bg-card p-4 text-left outline-none active:bg-muted focus-visible:shadow-focus">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono text-xs text-muted-foreground">{d.id}</div>
                    <div className="truncate text-sm font-medium">
                      {d.scenario.name} <span className="font-normal text-muted-foreground">v{d.scenario.version} · {PRESET_LABEL[d.preset]}</span>
                    </div>
                  </div>
                  <Badge tone={d.environment === "prod-like" ? "danger" : "neutral"}>{ENVIRONMENT_LABEL[d.environment]}</Badge>
                </div>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span>
                    <span className="text-sm font-semibold tabular-nums">{d.load ? `${d.load.value.toLocaleString("en-US")} ${d.load.unit}` : "—"}</span>{" "}
                    <span className="text-muted-foreground">
                      · {formatDuration(d.durationSec * 1000)} · <span className="font-mono">{d.target.name}</span>
                    </span>
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                  <div className="flex items-center gap-2">
                    <ApproverSlots d={d} now={now} />
                    <span className={cn("text-xs font-medium", badge.tone === "danger" ? "text-danger" : badge.tone === "info" ? "text-info" : "text-warning")}>{badge.label(d)}</span>
                  </div>
                  <Waited d={d} state={item.state} now={now} />
                </div>
                {!item.canApprove && item.reason ? <p className="text-xs text-muted-foreground">{item.reason}</p> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** UI-08 Approvals inbox: runs in this project that need approval. "For you" are the ones you can act on. */
export function ApprovalsView({ items, projectName }: { items: ReviewItem[]; projectName: string }) {
  const now = useNow(60_000);
  const sp = useSearchParams();
  const [open, setOpen] = React.useState<string | null>(sp.get("review"));
  const mine = items.filter((i) => i.canApprove).sort(byPriority);
  const others = items.filter((i) => !i.canApprove).sort(byPriority);
  const [tab, setTab] = React.useState(mine.length || !others.length ? "mine" : "others");

  const setReview = (id: string | null) => {
    setOpen(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("review", id);
    else url.searchParams.delete("review");
    window.history.replaceState(null, "", url);
  };
  const close = React.useCallback(() => setReview(null), []);
  const selected = items.find((i) => i.detail.id === open);

  return (
    <>
      <PageShell title="Approvals" subtitle={`${projectName} · ${mine.length ? `${mine.length} waiting for you` : "nothing waiting for you"}`} />
      <PageBody>
        {items.length ? (
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              {
                value: "mine",
                label: "For you",
                count: mine.length,
                content: (
                  <div className="pt-4">
                    {mine.length ? (
                      <ReviewTable items={mine} onOpen={setReview} now={now} />
                    ) : (
                      <EmptyState icon={<ShieldCheck />} title="You're all caught up" description="Nothing needs your approval right now. Runs you can't approve are under Others." />
                    )}
                  </div>
                ),
              },
              {
                value: "others",
                label: "Others",
                count: others.length,
                content: (
                  <div className="grid gap-3 pt-4">
                    <p className="text-xs text-muted-foreground">You created these, already approved them, or can&apos;t approve them. Each one says why.</p>
                    {others.length ? <ReviewTable items={others} onOpen={setReview} now={now} /> : <EmptyState icon={<ShieldCheck />} title="Nothing here" description="Every run waiting for approval is one you can review." />}
                  </div>
                ),
              },
            ]}
          />
        ) : (
          <EmptyState icon={<ShieldCheck />} title="Nothing to review" description={`No run in ${projectName} is waiting for approval. Smoke, baseline and peak runs on staging are approved by policy.`} />
        )}
      </PageBody>
      {selected ? <ReviewSheet key={selected.detail.id} item={selected} onClose={close} /> : null}
    </>
  );
}
