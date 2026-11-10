"use client";

import * as React from "react";
import { CircleCheck, OctagonX, RotateCw, TriangleAlert, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";

/*
 * Emergency stop (PRD E6.2 / N5). Always visible while a run is active.
 * Confirms in a popover anchored to the button: no modal (live metrics stay visible) and
 * nothing on the page moves.
 * Flow: idle → confirming → stopping (timer vs the stop target) → stopped | failed.
 */

type Phase = "idle" | "confirming" | "stopping" | "stopped" | "failed";

export interface EmergencyStopProps {
  /** Shown in the confirmation, e.g. "RUN-0421". */
  runId: string;
  /** Current load, so the person sees what they are stopping. */
  load?: { vus: number; rps: number };
  /** Pods must be gone within this many seconds (PRD N5: TBD, proposed 30). */
  targetSeconds?: number;
  /** Role check result. The server re-checks; this only explains the disabled button. */
  canStop?: boolean;
  disabledReason?: string;
  /** Deletes the TestRun. Reject with an Error to show the failure state. */
  onConfirm: () => Promise<void>;
}

const nf = new Intl.NumberFormat("en-US");

export function EmergencyStop({
  runId, load, targetSeconds = 30, canStop = true,
  disabledReason = "Only engineers and approvers can stop runs.", onConfirm,
}: EmergencyStopProps) {
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [elapsed, setElapsed] = React.useState(0);
  const [error, setError] = React.useState<string>();
  const startedAt = React.useRef(0);
  const uid = React.useId();
  const titleId = `${uid}-title`;
  const descId = `${uid}-desc`;

  React.useEffect(() => {
    if (phase !== "stopping") return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 250);
    return () => clearInterval(t);
  }, [phase]);

  async function stop() {
    startedAt.current = Date.now();
    setElapsed(0);
    setError(undefined);
    setPhase("stopping");
    try {
      await onConfirm();
      setElapsed(Math.max(1, Math.round((Date.now() - startedAt.current) / 1000)));
      setPhase("stopped");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The stop request did not reach the platform.");
      setPhase("failed");
    }
  }

  const overTarget = phase === "stopping" && elapsed > targetSeconds;
  const busy = phase === "stopping";

  return (
    <Popover
      open={phase !== "idle"}
      // Escape or a click outside cancels, except while the stop is in flight.
      onOpenChange={(open) => {
        if (!open && !busy) setPhase("idle");
      }}
    >
      <div className="grid justify-items-start gap-1">
        <PopoverAnchor asChild>
          <Button
            variant="danger"
            icon={<OctagonX />}
            loading={busy}
            disabled={!canStop || phase !== "idle"}
            onClick={() => setPhase("confirming")}
            aria-label="Emergency stop"
          >
            {/* Phones: short label so the page title beside it stays readable. */}
            <span className="max-sm:hidden">Emergency stop</span>
            <span className="sm:hidden">Stop</span>
          </Button>
        </PopoverAnchor>
        {!canStop ? <p className="text-micro text-muted-foreground">{disabledReason}</p> : null}
      </div>

      <PopoverContent
        align="start"
        sideOffset={8}
        collisionPadding={16}
        role="alertdialog"
        aria-labelledby={titleId}
        aria-describedby={descId}
        // Focus goes to the autoFocus button of each phase (Stop run now / Try again), not the first one.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (busy) e.preventDefault();
        }}
        className="grid w-[min(460px,calc(100vw-32px))] grid-cols-[72px_1fr] overflow-hidden border-danger/30 p-0"
      >
        {/* Decorative: the stop sign is the background of the left strip, oversized and cropped. */}
        <div aria-hidden className="relative overflow-hidden bg-danger/10">
          <OctagonX strokeWidth={1.5} className="absolute top-1/2 -left-9 size-32 -translate-y-1/2 -rotate-12 text-danger opacity-25" />
        </div>

        <div className="min-w-0 p-4">
          {phase === "confirming" ? (
            <>
              <div id={titleId} className="text-base font-semibold">
                Stop <span className="font-mono text-sm whitespace-nowrap">{runId}</span> now?
              </div>
              {load ? (
                <div className="mt-1 text-xs text-muted-foreground">
                  Sending <span className="font-semibold text-foreground tabular-nums">{nf.format(load.vus)} VUs</span> ·{" "}
                  <span className="font-semibold text-foreground tabular-nums">{nf.format(load.rps)} RPS</span> to the target
                </div>
              ) : null}
              <ul id={descId} className="mt-3 grid gap-1 text-xs text-muted-foreground">
                <li>· All runner pods stop within {targetSeconds} s.</li>
                <li>· The run ends as <span className="font-medium text-foreground">Aborted</span>, reason: emergency stop.</li>
                <li>· The stop is recorded in the audit log under your name. It cannot be undone.</li>
              </ul>
              <div className="mt-2 text-label text-secondary-foreground max-sm:hidden">Enter to stop · Esc to cancel</div>
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                <Button variant="outline" size="sm" icon={<X />} onClick={() => setPhase("idle")}>Cancel</Button>
                {/* Focus lands here: in an emergency, Enter should stop. */}
                <Button variant="danger" size="sm" icon={<OctagonX />} onClick={stop} autoFocus>Stop run now</Button>
              </div>
            </>
          ) : null}

          {phase === "stopping" ? (
            <div aria-live="polite">
              <div id={titleId} className="flex items-center gap-2 text-base font-semibold">
                <span aria-hidden className="size-3.5 animate-spin rounded-full border-2 border-danger border-r-transparent" />
                Stopping <span className="font-mono text-sm whitespace-nowrap">{runId}</span>
              </div>
              <div id={descId} className="mt-1 text-xs text-muted-foreground">
                Deleting the TestRun and telling every pod to stop.
              </div>
              <div className="mt-3 flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Time since stop" aria-valuemin={0} aria-valuemax={targetSeconds} aria-valuenow={Math.min(elapsed, targetSeconds)}>
                  <div
                    className={cn("h-full rounded-full transition-[width] duration-300", overTarget ? "bg-warning" : "bg-danger")}
                    style={{ width: `${Math.min(100, (elapsed / targetSeconds) * 100)}%` }}
                  />
                </div>
                <span className="w-16 text-right font-mono text-xs tabular-nums text-muted-foreground">{elapsed} / {targetSeconds} s</span>
              </div>
              {overTarget ? (
                <p className="mt-2 flex items-start gap-1.5 text-micro font-medium text-warning">
                  <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                  Slower than the {targetSeconds} s target. Pods still stop on their own when their lease expires.
                </p>
              ) : null}
            </div>
          ) : null}

          {phase === "stopped" ? (
            <div aria-live="polite">
              <div id={titleId} className="flex items-center gap-2 text-base font-semibold">
                <CircleCheck className="size-4 text-success" />
                <span className="font-mono text-sm whitespace-nowrap">{runId}</span> stopped
              </div>
              <p id={descId} className="mt-1 text-xs text-muted-foreground">
                Load stopped after {elapsed} s. The run is marked Aborted and the stop is in the audit log.
              </p>
              <div className="mt-3 flex justify-end">
                <Button variant="outline" size="sm" icon={<X />} onClick={() => setPhase("idle")}>Dismiss</Button>
              </div>
            </div>
          ) : null}

          {phase === "failed" ? (
            <div role="alert">
              <div id={titleId} className="flex items-center gap-2 text-base font-semibold text-danger">
                <TriangleAlert className="size-4" />
                Stop request failed
              </div>
              <p id={descId} className="mt-1 text-xs text-muted-foreground">
                {error} Load may still be running. Pods stop on their own when their lease expires.
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="outline" size="sm" icon={<X />} onClick={() => setPhase("idle")}>Close</Button>
                <Button variant="danger" size="sm" icon={<RotateCw />} onClick={stop} autoFocus>Try again</Button>
              </div>
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
