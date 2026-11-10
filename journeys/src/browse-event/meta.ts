import type { JourneyMeta } from "@btb/contracts";

/** Find: list events, then open one; a few Chromium VUs render the event page next to the API load. */
export const meta: JourneyMeta = {
  id: "browse-event",
  title: "Find (browse event)",
  description: "Lists the events and opens one, like a fan looking for a show. Chromium renders the event page under the run's network profile for page vitals.",
  version: "1.1.0",
  browser: true,
  steps: ["List events", "Open event"],
  params: [
    { name: "eventId", type: "string", default: "any", description: 'Event to open, or "any" for a random one from the list.' },
    { name: "thinkTimeSec", type: "number", default: 2, min: 0, max: 30, unit: "s", description: "Pause after each visit." },
  ],
  budgets: [
    { metric: "Each API call p95", budget: "≤ 500 ms" },
    { metric: "Event page p75 (browser)", budget: "LCP ≤ 2.5 s · INP ≤ 200 ms · CLS ≤ 0.1" },
  ],
};
