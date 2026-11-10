import * as React from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

import { cn } from "@/lib/utils";

export interface MetricCardProps {
  label: string;
  value: React.ReactNode;
  description?: string;
  trend?: { direction: "up" | "down"; label: string };
  /** The page's one giant number (3x). */
  hero?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export function MetricCard({ label, value, description, trend, hero, className, children }: MetricCardProps) {
  return (
    <div className={cn("rounded-lg border border-border bg-card", hero ? "p-5 shadow-sm" : "p-4", className)}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div
          className={cn(
            "font-semibold tabular-nums",
            hero ? "text-7xl leading-none tracking-[-0.03em]" : "text-2xl leading-8 tracking-[-0.01em]",
          )}
        >
          {value}
        </div>
        {trend ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium",
              trend.direction === "up" ? "bg-success-soft text-success" : "bg-danger-soft text-danger",
            )}
          >
            {trend.direction === "up" ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />}
            {trend.label}
          </span>
        ) : null}
      </div>
      {description ? <div className="mt-2 text-xs text-muted-foreground">{description}</div> : null}
      {children}
    </div>
  );
}
