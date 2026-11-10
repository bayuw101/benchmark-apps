import { TriangleAlert } from "lucide-react";

import type { PolicyViolation } from "@/lib/runs/types";

export type { PolicyViolation };

export function PolicyViolations({ violations }: { violations: PolicyViolation[] }) {
  if (!violations.length) return null;
  return (
    <ul role="alert" className="grid gap-1.5">
      {violations.map((v) => (
        <li
          key={`${v.field}:${v.rule}`}
          className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-danger"
        >
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-semibold">{v.message}</div>
            <div className="font-mono text-micro opacity-80">
              {v.field} · {v.rule}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
