"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Check, CircleAlert, Clock, ExternalLink, Info, ShieldCheck, UserRound, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDuration, relativeTime } from "@/lib/time";
import { useNow } from "@/lib/use-now";
import { ENVIRONMENT_LABEL, NETWORK_PROFILES } from "@btb/core/policy";
import { parseWith, rejectInputSchema } from "@btb/contracts/schemas";
import { PRESET_LABEL, type PolicyViolation, type RunDetail } from "@/lib/runs/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LinkPending } from "@/components/arbiter/link-pending";
import { RightPullSheet } from "@/components/arbiter/right-pull-sheet";
import { TextareaField } from "@/components/arbiter/textarea-field";
import { notify } from "@/components/arbiter/toast";
import { HashDisplay } from "@/components/btb/hash-display";
import { useNavigate } from "@/components/navigation";

import type { ReviewItem, ReviewState } from "@/lib/runs/review";

export type { ReviewItem };

export const STATE_BADGE: Record<ReviewState, { tone: "warning" | "info" | "danger"; label: (d: RunDetail) => string }> = {
  waiting: { tone: "warning", label: (d) => (d.approvalsRequired === 2 ? "Needs 2 approvers" : "Needs 1 approver") },
  partial: { tone: "info", label: (d) => `${d.approvalRecords.length} of ${d.approvalsRequired} approved` },
  edited: { tone: "danger", label: () => "Needs re-approval: edited" },
  expired: { tone: "danger", label: () => "Needs re-approval: expired" },
};

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

class ReviewError extends Error {
  constructor(readonly status: number, readonly body: { reason?: string; violations?: PolicyViolation[] } = {}) {
    super(`review failed: ${status}`);
  }
}

async function post(url: string, body?: unknown): Promise<RunDetail> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ReviewError(res.status, json);
  return json;
}

function Fact({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border border-border px-3 py-2">
      <dt className="text-micro text-muted-foreground">{label}</dt>
      <dd className="text-sm font-semibold">{children}</dd>
      {hint ? <dd className="text-micro text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}

/**
 * The approver's view of one run: exactly what they authorize (PRD story 9: target, max load, duration, window,
 * thresholds, manifest and hash), then Approve or Reject with a reason.
 */
export function ReviewSheet({ item, onClose }: { item: ReviewItem; onClose: () => void }) {
  const d = item.detail;
  const now = useNow(60_000);
  const nav = useNavigate();
  const [rejecting, setRejecting] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [noteError, setNoteError] = React.useState<string>();
  // Close once the refreshed inbox (and badge) is on screen.
  const [done, setDone] = React.useState(false);
  React.useEffect(() => {
    if (done && !nav.pending) onClose();
  }, [done, nav.pending, onClose]);

  const finish = () => {
    setDone(true);
    nav.refresh();
  };
  const fail = (error: unknown, title: string) => {
    if (error instanceof ReviewError && error.status === 422) setNoteError(error.body.violations?.[0]?.message);
    else if (error instanceof ReviewError && error.status === 409) notify.error(title, error.body.reason);
    else notify.error(title, "The service didn't answer. Try again.");
  };

  const approve = useMutation({
    mutationFn: () => post(`/api/runs/${encodeURIComponent(d.id)}/approve`),
    onSuccess: (r) => {
      notify.success(
        `${d.id} approved`,
        r.status === "approved" ? `${d.createdBy.name} can start it until ${r.approvalExpiresAt ? when(r.approvalExpiresAt) : "the approval expires"}.` : "One more approver is needed.",
      );
      finish();
    },
    onError: (e) => fail(e, "Couldn't approve"),
  });
  const reject = useMutation({
    mutationFn: (body: { note?: string }) => post(`/api/runs/${encodeURIComponent(d.id)}/reject`, body),
    onSuccess: () => {
      notify.success(`${d.id} rejected`, `${d.createdBy.name} sees your reason on the run.`);
      finish();
    },
    onError: (e) => fail(e, "Couldn't reject"),
  });
  const busy = approve.isPending || reject.isPending || done;
  // Same zod schema as the API; the "say why" rule stays on the server (422).
  const submitReject = () => {
    const parsed = parseWith(rejectInputSchema, { note });
    if (parsed.ok) reject.mutate(parsed.data);
    else setNoteError(parsed.violations[0]?.message);
  };
  const badge = STATE_BADGE[item.state];
  const t = d.manifest.thresholds as { p95Ms: number; errorRatePct: number } | null | undefined;
  const load = d.manifest.load as { rampSec: number } | undefined;

  return (
    <RightPullSheet
      open
      wide
      title={`Review ${d.id}`}
      subtitle={`${d.scenario.name} v${d.scenario.version} · ${d.projectName}`}
      onClose={onClose}
      footer={
        rejecting ? (
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:justify-end">
            <Button variant="outline" icon={<ArrowLeft />} disabled={busy} onClick={() => setRejecting(false)}>
              Back
            </Button>
            <Button variant="danger" icon={<X />} loading={reject.isPending || (done && reject.isSuccess)} onClick={submitReject}>
              Reject run
            </Button>
          </div>
        ) : (
          <div className="grid w-full gap-2 sm:flex sm:items-center sm:justify-between">
            {!item.canApprove && item.reason ? (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-px size-3.5 shrink-0" />
                {item.reason}
              </p>
            ) : (
              <span className="text-xs text-muted-foreground max-sm:hidden">Your approval binds to this exact hash.</span>
            )}
            <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
              <Button variant="outline" icon={<X />} disabled={!item.canApprove || busy} onClick={() => setRejecting(true)}>
                Reject
              </Button>
              <Button icon={<Check />} disabled={!item.canApprove} loading={approve.isPending || (done && approve.isSuccess)} onClick={() => approve.mutate()}>
                {item.state === "expired" ? "Approve again" : "Approve"}
              </Button>
            </div>
          </div>
        )
      }
    >
      <div className="grid gap-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Badge tone={badge.tone} dot>
            {badge.label(d)}
          </Badge>
          <span className="text-xs text-muted-foreground">
            Requested by {d.createdBy.name} {relativeTime(new Date(d.createdAt), now)}
          </span>
        </div>

        {item.state === "edited" ? (
          <p className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
            <CircleAlert className="mt-px size-3.5 shrink-0" />
            The run was edited after {d.voidedApprovals === 1 ? "an approval" : `${d.voidedApprovals} approvals`}. Those no longer count: this is a new hash.
          </p>
        ) : item.state === "expired" ? (
          <p className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
            <Clock className="mt-px size-3.5 shrink-0" />
            The approval expired {d.approvalExpiresAt ? relativeTime(new Date(d.approvalExpiresAt), now) : ""} before anyone started the run. Approving again gives a new 24-hour window.
          </p>
        ) : null}

        <section className="grid gap-3">
          <h3 className="text-sm font-semibold">What you&apos;re approving</h3>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Fact label="Target" hint={ENVIRONMENT_LABEL[d.environment]}>
              <span className="font-mono text-xs">{d.target.name}</span>
            </Fact>
            <Fact label="Max load" hint={PRESET_LABEL[d.preset]}>
              {d.load ? `${d.load.value.toLocaleString("en-US")} ${d.load.unit}` : "—"}
            </Fact>
            <Fact label="Duration" hint={load?.rampSec ? `Full load after ${formatDuration(load.rampSec * 1000)}` : undefined}>
              {formatDuration(d.durationSec * 1000)}
            </Fact>
            <Fact label="Window" hint="From your approval">
              24 hours
            </Fact>
            <Fact label="Thresholds" hint="Abort on fail">
              {t ? `p95 ≤ ${t.p95Ms} ms · errors ≤ ${t.errorRatePct}%` : <span className="text-danger">None</span>}
            </Fact>
            <Fact label="Network">{d.network ? NETWORK_PROFILES[d.network].label : "Protocol only"}</Fact>
          </dl>
        </section>

        <section className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Manifest</h3>
            <HashDisplay hash={d.manifestHash} />
          </div>
          <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">{JSON.stringify(d.manifest, null, 2)}</pre>
        </section>

        <section className="grid gap-2">
          <h3 className="text-sm font-semibold">
            Approvals <span className="font-normal text-muted-foreground">· {d.approvalsRequired === 2 ? "2 different approvers, neither the starter" : "1 approver who isn't the starter"}</span>
          </h3>
          <ul className="grid gap-2">
            {d.approvalRecords.map((a) => (
              <li key={a.by + a.at} className="flex items-center gap-2.5 text-sm">
                <span className="flex size-7 items-center justify-center rounded-full bg-success-soft text-success [&_svg]:size-3.5">
                  <UserRound />
                </span>
                <span className="font-medium">{a.by}</span>
                <span className={cn("text-xs", a.expiresAt < now.toISOString() ? "text-danger" : "text-muted-foreground")}>
                  {relativeTime(new Date(a.at), now)}
                  {a.expiresAt < now.toISOString() ? " · expired" : ""}
                </span>
              </li>
            ))}
            {Array.from({ length: Math.max(0, d.approvalsRequired - d.approvalRecords.length) }, (_, i) => (
              <li key={i} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <span className="flex size-7 items-center justify-center rounded-full border border-dashed border-border-strong [&_svg]:size-3.5">
                  <ShieldCheck />
                </span>
                Waiting for an approver
              </li>
            ))}
          </ul>
        </section>

        {rejecting ? (
          <section className="grid gap-2 border-t border-border pt-5">
            <h3 className="text-sm font-semibold">Why are you rejecting it?</h3>
            <TextareaField
              label="Reason for the engineer"
              rows={3}
              value={note}
              onChange={(e) => (setNote(e.target.value), setNoteError(undefined))}
              hint="They read this on the run. Say what would make it approvable."
              error={noteError}
            />
          </section>
        ) : null}

        <Link href={`/runs/${encodeURIComponent(d.id)}`} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          <LinkPending className="size-3">
            <ExternalLink className="size-3" />
          </LinkPending>
          Open the full run page
        </Link>
      </div>
    </RightPullSheet>
  );
}
