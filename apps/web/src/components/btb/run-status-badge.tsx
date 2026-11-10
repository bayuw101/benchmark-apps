import { Badge } from "@/components/ui/badge";
import { RUN_STATUS_META, type RunStatus } from "@/lib/run-status";

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const meta = RUN_STATUS_META[status];
  return (
    <Badge tone={meta.tone} dot pulse={meta.live}>
      {meta.label}
    </Badge>
  );
}
