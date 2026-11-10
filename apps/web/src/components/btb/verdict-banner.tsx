import { CircleCheck, CircleX, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { VerdictCaveat } from "@/lib/runs/types";

export type { VerdictCaveat };

const CAVEAT_LABEL: Record<VerdictCaveat, string> = {
  measurement_gap: "Measurement gap",
  generator_saturated: "Generator saturated",
  integrity_not_verified: "Integrity not verified",
};

// Card ground, not a -soft fill: the -soft tokens have no dark values in the source.
export function VerdictBanner({
  verdict,
  summary,
  caveats = [],
}: {
  verdict: "pass" | "fail";
  summary?: string;
  caveats?: VerdictCaveat[];
}) {
  const pass = verdict === "pass";
  const Icon = pass ? CircleCheck : CircleX;
  return (
    <div
      role="status"
      className={cn("grid gap-3 rounded-lg border bg-card p-5 shadow-sm", pass ? "border-success/40" : "border-danger/40")}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full",
            pass ? "bg-success-soft text-success" : "bg-danger-soft text-danger",
          )}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <div className={cn("text-2xl font-semibold", pass ? "text-success" : "text-danger")}>{pass ? "Pass" : "Fail"}</div>
          {summary ? <p className="text-sm text-foreground">{summary}</p> : null}
        </div>
      </div>
      {caveats.length ? (
        <div className="flex flex-wrap gap-1.5">
          {caveats.map((c) => (
            <Badge key={c} tone="warning">
              <TriangleAlert />
              {CAVEAT_LABEL[c]}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}
