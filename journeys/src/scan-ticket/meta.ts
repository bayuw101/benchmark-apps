import type { JourneyMeta } from "@btb/contracts";

/** Enter: scan tickets at a gate. Best run with the arrival-rate model (scans per second). */
export const meta: JourneyMeta = {
  id: "scan-ticket",
  title: "Enter (scan ticket)",
  description: "Scans pre-issued gate tickets, one per iteration. A ticket already used (409) is a valid answer, not an error.",
  version: "1.0.0",
  browser: false,
  steps: ["Scan"],
  params: [
    { name: "gate", type: "string", default: "gate-a", description: "Gate name sent with each scan." },
    { name: "ticketPool", type: "number", default: 100000, min: 1, max: 1000000, description: "Pre-issued tickets on the target (gate-0 ... gate-N-1)." },
    { name: "thinkTimeSec", type: "number", default: 0, min: 0, max: 30, unit: "s", description: "Pause after each scan (closed model only)." },
  ],
  budgets: [{ metric: "Scan p95", budget: "≤ 300 ms" }],
};
