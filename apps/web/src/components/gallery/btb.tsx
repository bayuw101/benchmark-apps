"use client";

import * as React from "react";

import { EmergencyStop } from "@/components/btb/emergency-stop";
import { HashDisplay } from "@/components/btb/hash-display";
import type { LivePoint } from "@/components/btb/live-metric-chart";
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

// recharts is ~150 kB: load it only when this section renders, not with the whole gallery.
const LiveMetricChart = dynamic(() => import("@/components/btb/live-metric-chart").then((m) => m.LiveMetricChart), {
  ssr: false,
  loading: () => <Skeleton className="h-[232px] w-full" />,
});
import { PolicyViolations, type PolicyViolation } from "@/components/btb/policy-violations";
import { PreflightChecklist, type PreflightResults } from "@/components/btb/preflight-checklist";
import { RunStatusBadge } from "@/components/btb/run-status-badge";
import { ThresholdMetricCard } from "@/components/btb/threshold-metric-card";
import { VerdictBanner } from "@/components/btb/verdict-banner";
import { Switch } from "@/components/ui/switch";
import { RUN_STATUSES } from "@/lib/run-status";

const HASH = "a3f9c1d84b2e7f0659c3a1e8d74b2c90f61e5a38d2c7b4e9015f6a3c8d9be7d2";

const VIOLATIONS: PolicyViolation[] = [
  { field: "target", rule: "allowlist", message: "Target host checkout.staging.example is not on the allowlist" },
  { field: "preset", rule: "vu_ceiling", message: "Peak load 1,800 VUs exceeds the environment ceiling of 1,200 VUs" },
  { field: "thresholds", rule: "required", message: "Add at least one threshold before the run can be created" },
];

const PREFLIGHT: PreflightResults = {
  approval: { state: "pass" },
  target: { state: "pass" },
  window: { state: "pass" },
  test_data: { state: "fail", reason: "Pool has 40 free identities; the run needs 120" },
  target_health: { state: "checking" },
  monitoring: { state: "pending" },
  runner_capacity: { state: "pending" },
};

// deterministic mock series so server and client render the same values.
const P95: LivePoint[] = Array.from({ length: 24 }, (_, i) => ({
  t: `12:${String(i * 5 < 60 ? 0 : 1).padStart(2, "0")}:${String((i * 5) % 60).padStart(2, "0")}`,
  value: Math.round(520 + i * 14 + Math.sin(i / 2) * 60),
}));

export function BtbSection() {
  const [stale, setStale] = React.useState(false);
  return (
    <section id="btb" className="grid scroll-mt-20 grid-cols-1 gap-4">
      <div>
        <div className="text-sm font-semibold">BTB components</div>
        <p className="text-xs text-muted-foreground">
          Platform-specific pieces from the UI plan: run status, hash, verdict, policy violations, preflight, emergency stop,
          threshold metrics and live chart.
        </p>
      </div>

      <div className="grid gap-2">
        <div className="text-xs font-medium text-muted-foreground">Run status (11)</div>
        <div className="flex flex-wrap gap-2">
          {RUN_STATUSES.map((s) => (
            <RunStatusBadge key={s} status={s} />
          ))}
        </div>
      </div>

      <div className="grid gap-1">
        <div className="text-xs font-medium text-muted-foreground">Manifest hash</div>
        <HashDisplay hash={HASH} />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="grid content-start gap-1">
          <div className="text-xs font-medium text-muted-foreground">Emergency stop · stops in 4 s</div>
          <EmergencyStop runId="RUN-0421" load={{ vus: 1200, rps: 1184 }} onConfirm={() => new Promise((r) => setTimeout(r, 4000))} />
        </div>
        <div className="grid content-start gap-1">
          <div className="text-xs font-medium text-muted-foreground">Stop request fails</div>
          <EmergencyStop
            runId="RUN-0420"
            load={{ vus: 800, rps: 760 }}
            onConfirm={() => new Promise((_, reject) => setTimeout(() => reject(new Error("The API did not answer within 10 s.")), 1500))}
          />
        </div>
        <div className="grid content-start gap-1">
          <div className="text-xs font-medium text-muted-foreground">Viewer role</div>
          <EmergencyStop runId="RUN-0419" canStop={false} onConfirm={() => Promise.resolve()} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <ThresholdMetricCard hero label="p95 latency" value="842" unit="ms" threshold="≤ 800 ms" pass={false} />
        <div className="grid gap-2">
          <ThresholdMetricCard label="Error rate" value="0.42" unit="%" threshold="≤ 1%" pass />
          <div className="grid grid-cols-2 gap-2">
            <ThresholdMetricCard label="Peak RPS" value="1,284" />
            <ThresholdMetricCard label="Max VUs" value="1,200" />
          </div>
        </div>
      </div>

      <VerdictBanner
        verdict="fail"
        summary="p95 latency on checkout was 842 ms against a threshold of 800 ms."
        caveats={["generator_saturated", "integrity_not_verified"]}
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="grid content-start gap-2">
          <div className="text-xs font-medium text-muted-foreground">Policy rejection (HTTP 422)</div>
          <PolicyViolations violations={VIOLATIONS} />
        </div>
        <div className="grid content-start gap-2">
          <div className="text-xs font-medium text-muted-foreground">Preflight</div>
          <PreflightChecklist results={PREFLIGHT} />
        </div>
      </div>

      <div className="grid gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={stale} onCheckedChange={setStale} />
          Simulate lost live connection
        </label>
        <LiveMetricChart title="p95 latency" unit="ms" data={P95} threshold={800} stale={stale} />
      </div>
    </section>
  );
}
