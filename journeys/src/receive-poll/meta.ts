import type { JourneyMeta } from "@btb/contracts";

/** Receive: buy one seat, then poll until the ticket shows up in the account (PRD: viewable within 1 minute). */
export const meta: JourneyMeta = {
  id: "receive-poll",
  title: "Receive (ticket polling)",
  description: "Orders one seat and polls the order until its ticket is viewable. Records the time to ticket; over the deadline counts as late.",
  version: "1.0.0",
  browser: false,
  steps: ["Place order", "Wait for ticket"],
  params: [
    { name: "eventId", type: "string", default: "evt-2", description: "Event to buy. Must exist on the target." },
    { name: "pollIntervalSec", type: "number", default: 2, min: 1, max: 30, unit: "s", description: "Pause between two polls." },
    { name: "deadlineSec", type: "number", default: 60, min: 5, max: 300, unit: "s", description: "Longest wait for the ticket before it counts as late." },
    { name: "thinkTimeSec", type: "number", default: 1, min: 0, max: 30, unit: "s", description: "Pause after each purchase." },
  ],
  budgets: [
    { metric: "Ticket viewable", budget: "≤ 1 min" },
    { metric: "Each API call p95", budget: "≤ 500 ms" },
  ],
};
