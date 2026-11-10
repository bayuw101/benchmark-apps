import { Badge } from "@/components/ui/badge";

/* StatusPill: active/inactive only; any other state uses Badge */

export function StatusPill({ active, activeLabel = "Active", inactiveLabel = "Inactive" }: { active: boolean; activeLabel?: string; inactiveLabel?: string }) {
  return (
    <Badge tone={active ? "success" : "neutral"} dot>
      {active ? activeLabel : inactiveLabel}
    </Badge>
  );
}
