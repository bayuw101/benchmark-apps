import { CircleCheck, CircleDashed, CircleX } from "lucide-react";

import { Spinner } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { PreflightKey, PreflightResults, PreflightState } from "@/lib/runs/types";

export type { PreflightKey, PreflightResults, PreflightState };

/** The 7 preflight checks from PRD E3.4. Any failure blocks Start and names the failed check. */
export const PREFLIGHT_CHECKS: readonly { key: PreflightKey; label: string }[] = [
  { key: "approval", label: "Valid approval" },
  { key: "target", label: "Permitted target" },
  { key: "window", label: "Inside time window" },
  { key: "test_data", label: "Test-data pool ready" },
  { key: "target_health", label: "Target health endpoint OK" },
  { key: "monitoring", label: "Monitoring available" },
  { key: "runner_capacity", label: "Runner capacity" },
];

const STATE_LABEL: Record<PreflightState, string> = {
  pass: "Passed",
  fail: "Failed",
  checking: "Checking",
  pending: "Not checked",
};

export function PreflightChecklist({ results }: { results: PreflightResults }) {
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-card">
      {PREFLIGHT_CHECKS.map((c) => {
        const r = results[c.key] ?? { state: "pending" as const };
        return (
          <li key={c.key} className="flex items-start gap-3 px-4 py-2.5">
            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center" aria-hidden>
              {r.state === "pass" ? (
                <CircleCheck className="size-4 text-success" />
              ) : r.state === "fail" ? (
                <CircleX className="size-4 text-danger" />
              ) : r.state === "checking" ? (
                <Spinner className="text-muted-foreground" />
              ) : (
                <CircleDashed className="size-4 text-border-strong" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className={cn("text-sm", r.state === "pending" ? "text-muted-foreground" : "text-foreground")}>
                {c.label}
              </div>
              {r.state === "fail" && r.reason ? (
                <p className="text-micro font-medium text-danger">{r.reason}</p>
              ) : null}
            </div>
            <span className="text-xs text-muted-foreground">{STATE_LABEL[r.state]}</span>
          </li>
        );
      })}
    </ul>
  );
}
