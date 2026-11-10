import type { JourneyMeta } from "@btb/contracts";

/**
 * Buy seats on the mock ticketing target, the whole way: pick an event, hold seats in a cart, check out, pay in the
 * sandbox (with an idempotency key), then wait for the order to confirm. Protocol only (no browser). PRD E7.4.
 */
export const meta: JourneyMeta = {
  id: "checkout",
  title: "Buy (checkout)",
  description:
    "Opens an event, holds seats, checks out, pays in the sandbox and waits for the order to confirm. Sold out (409) is a valid end, not an error. A payment retry reuses its idempotency key, so a dropped connection never charges twice.",
  version: "2.0.0",
  browser: false,
  steps: ["Select ticket", "Cart", "Checkout", "Payment", "Confirmation"],
  params: [
    { name: "eventId", type: "string", default: "evt-1", description: "Event to buy. Must exist on the target." },
    { name: "ticketsPerOrder", type: "number", default: 1, min: 1, max: 10, description: "Seats in each order." },
    { name: "paymentMethod", type: "string", default: "card-sandbox", description: "Sandbox payment method. Anything else is declined (402)." },
    { name: "paymentRetries", type: "number", default: 2, min: 0, max: 5, description: "Retries after a dropped connection, 429 or 5xx, with the same idempotency key." },
    { name: "confirmDeadlineSec", type: "number", default: 30, min: 1, max: 300, unit: "s", description: "Longest wait from payment to a confirmed order." },
    { name: "thinkTimeSec", type: "number", default: 1, min: 0, max: 30, unit: "s", description: "Pause after each purchase, like a real fan." },
  ],
  budgets: [
    { metric: "Payment → confirmation p95", budget: "≤ 3 s" },
    { metric: "Each API call p95", budget: "≤ 500 ms" },
  ],
};
