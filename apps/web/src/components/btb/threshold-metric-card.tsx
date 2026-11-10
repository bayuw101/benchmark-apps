import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function ThresholdMetricCard({
  label,
  value,
  unit,
  threshold,
  pass,
  hero,
  className,
}: {
  label: string;
  value: string;
  unit?: string;
  /** e.g. "≤ 800 ms" */
  threshold?: string;
  /** Omit when there is no threshold to judge against. */
  pass?: boolean;
  hero?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border bg-card p-4", hero && "p-5 shadow-sm", className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        {pass === undefined ? null : (
          <Badge tone={pass ? "success" : "danger"} dot>
            {pass ? "Pass" : "Fail"}
          </Badge>
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span
          className={cn(
            "font-semibold tracking-tight tabular-nums",
            hero ? "text-7xl leading-none tracking-[-0.03em]" : "text-2xl",
          )}
        >
          {value}
        </span>
        {unit ? <span className="text-sm text-muted-foreground">{unit}</span> : null}
      </div>
      {threshold ? <div className="mt-2 text-xs text-muted-foreground">Threshold {threshold}</div> : null}
    </div>
  );
}
