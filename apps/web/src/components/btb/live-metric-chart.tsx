"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { Clock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

export interface LivePoint {
  /** Label for the x axis, e.g. "12:04:05". */
  t: string;
  value: number;
}

/** One live metric (e.g. p95) with a dashed threshold line. Updated every 5 s over SSE by the caller. */
export function LiveMetricChart({
  title,
  unit,
  data,
  threshold,
  stale,
}: {
  title: string;
  unit: string;
  data: LivePoint[];
  threshold?: number;
  /** Live connection lost: data is delayed. */
  stale?: boolean;
}) {
  const config = { value: { label: title, color: "var(--chart-1)" } } satisfies ChartConfig;
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">
          {title} <span className="text-secondary-foreground">({unit})</span>
        </div>
        {stale ? (
          <Badge tone="warning">
            <Clock />
            Data delayed
          </Badge>
        ) : null}
      </div>
      <ChartContainer config={config} className="aspect-auto h-48 w-full">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="t" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tick={{ fontSize: 10 }} />
          <YAxis width={40} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
          <ChartTooltip cursor={{ stroke: "var(--border-strong)" }} content={<ChartTooltipContent indicator="line" />} />
          {threshold !== undefined ? (
            <ReferenceLine
              y={threshold}
              stroke="var(--danger)"
              strokeDasharray="4 4"
              label={{ value: `Threshold ${threshold} ${unit}`, position: "insideTopRight", fontSize: 10, fill: "var(--danger)" }}
            />
          ) : null}
          <Line
            dataKey="value"
            type="monotone"
            stroke="var(--color-value)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            strokeOpacity={stale ? 0.4 : 1}
          />
        </LineChart>
      </ChartContainer>
    </div>
  );
}
