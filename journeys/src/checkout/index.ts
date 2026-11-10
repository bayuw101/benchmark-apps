import type { JourneyContext } from "@btb/k6-lib";
import { check, group, sleep } from "k6";
import exec from "k6/execution";
import http from "k6/http";
import { Counter, Trend } from "k6/metrics";

import { meta } from "./meta";

const [SELECT, CART, CHECKOUT, PAYMENT, CONFIRMATION] = meta.steps;

/*
 * Funnel metrics (PRD E7.4), all tagged `step`: reached − completed is the drop-off at that step, and the
 * duration is the step's wall time including retries and polling (http_req_duration only has single calls).
 */
const stepReached = new Counter("btb_step_reached");
const stepCompleted = new Counter("btb_step_completed");
const stepDuration = new Trend("btb_step_duration", true);
const paymentToConfirmation = new Trend("btb_payment_to_confirmation", true);
/**
 * Integrity counters (PRD E7.7), tagged `item`: what this journey believes it bought. The integrity adapter
 * compares them with the target's own records (orders, seats, tickets, charges).
 */
const integrity = new Counter("btb_integrity");

const CONFIRM_POLL_SEC = 0.25;
const MAX_RETRY_WAIT_SEC = 5;

/** Runs one funnel step. `body` returns true when the step succeeded and the journey should go on. */
function step(name: string, body: () => boolean): boolean {
  const tags = { step: name };
  stepReached.add(1, tags);
  const started = Date.now();
  const ok = group(name, body);
  stepDuration.add(Date.now() - started, tags);
  if (ok) stepCompleted.add(1, tags);
  return ok;
}

/** Retry only what a retry can fix: connection lost (status 0), rate limited, or a server error. */
const retryable = (status: number) => status === 0 || status === 429 || status >= 500;

export function run({ http: target, params }: JourneyContext) {
  const eventId = String(params.eventId);
  const qty = Number(params.ticketsPerOrder);
  let cartId = "";
  let checkoutId = "";
  let orderId = "";
  let paidAt = 0;

  // Each step runs only if the one before it succeeded; where it stops is the drop-off.
  step(SELECT, () => {
      const res = target.get(`/events/${encodeURIComponent(eventId)}`, { tags: { name: "GET /events/:id" } });
      check(res, { "event 200": (r) => r.status === 200 });
      // Nothing left to buy is a normal end of the funnel, not an error.
      return res.status === 200 && Number(res.json("remaining")) >= qty;
    }) &&
    step(CART, () => {
      const res = target.postJson("/carts", { eventId, qty }, { tags: { name: "POST /carts" }, responseCallback: http.expectedStatuses(201, 409) });
      check(res, { "cart 201 or 409": (r) => r.status === 201 || r.status === 409 });
      if (res.status === 201) cartId = String(res.json("cartId"));
      return Boolean(cartId);
    }) &&
    step(CHECKOUT, () => {
      const res = target.postJson("/checkouts", { cartId }, { tags: { name: "POST /checkouts" } });
      check(res, { "checkout 201": (r) => r.status === 201 });
      if (res.status === 201) checkoutId = String(res.json("checkoutId"));
      return Boolean(checkoutId);
    }) &&
    step(PAYMENT, () => {
      // One key per checkout, kept across retries: the sandbox replays the first answer instead of charging again.
      // k6's Go HTTP client also silently re-sends a request that carries Idempotency-Key when a reused connection
      // drops, so this loop mostly handles 429, 5xx and fresh-connection drops.
      const key = `btb-${exec.vu.idInTest}-${exec.vu.iterationInScenario}-${checkoutId}`;
      const body = { checkoutId, method: String(params.paymentMethod) };
      const tries = Number(params.paymentRetries) + 1;
      paidAt = Date.now();
      for (let attempt = 1; attempt <= tries; attempt++) {
        const res = target.postJson("/payments", body, {
          headers: { "Idempotency-Key": key },
          tags: { name: "POST /payments", attempt: attempt === 1 ? "first" : "retry" },
          responseCallback: http.expectedStatuses(201),
        });
        if (res.status === 201) {
          orderId = String(res.json("orderId") ?? "");
          integrity.add(1, { item: "charge" });
          if (orderId) {
            integrity.add(1, { item: "order" });
            integrity.add(qty, { item: "seat" });
          }
          break;
        }
        if (!retryable(res.status) || attempt === tries) break;
        sleep(res.status === 429 ? Math.min(MAX_RETRY_WAIT_SEC, Number(res.headers["Retry-After"]) || 1) : 0.5 * attempt);
      }
      check(null, { "payment captured": () => Boolean(orderId) });
      return Boolean(orderId);
    }) &&
    step(CONFIRMATION, () => {
      const deadline = paidAt + Number(params.confirmDeadlineSec) * 1000;
      let confirmed = false;
      while (!confirmed && Date.now() < deadline) {
        const res = target.get(`/orders/${encodeURIComponent(orderId)}`, { tags: { name: "GET /orders/:id" } });
        confirmed = res.status === 200 && res.json("status") === "confirmed";
        if (confirmed && res.json("ticketId")) integrity.add(1, { item: "ticket" });
        if (!confirmed) sleep(CONFIRM_POLL_SEC);
      }
      if (confirmed) paymentToConfirmation.add(Date.now() - paidAt);
      check(null, { "order confirmed before the deadline": () => confirmed });
      return confirmed;
    });

  const think = Number(params.thinkTimeSec);
  if (think > 0) sleep(think);
}
