"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import type { ReleasePoint } from "@/lib/runs/types";

type Metric = "p95Ms" | "errorRatePct" | "peakRps";

const METRICS: { key: Metric; title: string; unit: string; format: (n: number) => string }[] = [
  { key: "p95Ms", title: "p95 latency", unit: "ms", format: (n) => `${n.toLocaleString("en-US")} ms` },
  { key: "errorRatePct", title: "Error rate", unit: "%", format: (n) => `${n}%` },
  { key: "peakRps", title: "Peak RPS", unit: "RPS", format: (n) => n.toLocaleString("en-US") },
];

/**
 * E9.7: p95, error rate and peak RPS per release, one small chart each (different scales never share an
 * axis). The run being viewed gets a larger dot; thresholds are the run's own.
 */
export function ReleaseTrend({ points, currentRunId, thresholds }: { points: ReleasePoint[]; currentRunId: string; thresholds: { p95Ms: number; errorRatePct: number } | null }) {
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {METRICS.map((m) => (
          <TrendChart key={m.key} metric={m} points={points} currentRunId={currentRunId} threshold={m.key === "peakRps" ? undefined : thresholds?.[m.key]} />
        ))}
      </div>
      <table className="sr-only">
        <caption>Release trend</caption>
        <thead>
          <tr>
            <th>Release</th>
            <th>Run</th>
            {METRICS.map((m) => (
              <th key={m.key}>{m.title}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.releaseId}>
              <td>{p.releaseId}</td>
              <td>{p.runId}</td>
              {METRICS.map((m) => (
                <td key={m.key}>{m.format(p[m.key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TrendChart({ metric, points, currentRunId, threshold }: { metric: (typeof METRICS)[number]; points: ReleasePoint[]; currentRunId: string; threshold?: number }) {
  const config = { [metric.key]: { label: metric.title, color: "var(--chart-1)" } } satisfies ChartConfig;
  return (
    <div className="rounded-lg border border-border p-4" aria-hidden>
      <div className="mb-3 text-xs font-medium text-muted-foreground">
        {metric.title} <span className="text-secondary-foreground">({metric.unit})</span>
      </div>
      <ChartContainer config={config} className="aspect-auto h-40 w-full">
        <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="releaseId" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} tick={{ fontSize: 10 }} />
          <YAxis width={40} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
          <ChartTooltip
            cursor={{ stroke: "var(--border-strong)" }}
            content={({ active, payload }) => {
              const p = active ? (payload?.[0]?.payload as ReleasePoint | undefined) : undefined;
              if (!p) return null;
              return (
                <div className="grid gap-0.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs shadow-xl">
                  <span className="font-mono font-medium">{p.releaseId}</span>
                  <span className="font-semibold tabular-nums">{metric.format(p[metric.key])}</span>
                  <span className="text-muted-foreground">
                    {p.runId}
                    {p.runId === currentRunId ? " · this run" : ""}
                    {p.verdict ? ` · ${p.verdict}` : ""}
                  </span>
                </div>
              );
            }}
          />
          {threshold !== undefined ? <ReferenceLine y={threshold} stroke="var(--danger)" strokeDasharray="4 4" /> : null}
          <Line
            dataKey={metric.key}
            type="linear"
            stroke={`var(--color-${metric.key})`}
            strokeWidth={2}
            isAnimationActive={false}
            dot={(props: { cx?: number; cy?: number; payload?: ReleasePoint; index?: number }) => {
              const current = props.payload?.runId === currentRunId;
              return (
                <circle
                  key={props.index}
                  cx={props.cx}
                  cy={props.cy}
                  r={current ? 6 : 4}
                  fill={current ? `var(--color-${metric.key})` : "var(--card)"}
                  stroke={`var(--color-${metric.key})`}
                  strokeWidth={2}
                />
              );
            }}
            activeDot={{ r: 6, stroke: "var(--card)", strokeWidth: 2 }}
          />
        </LineChart>
      </ChartContainer>
    </div>
  );
}
