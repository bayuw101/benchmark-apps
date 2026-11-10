import type { JourneyContext } from "@btb/k6-lib";
import { check, group, sleep } from "k6";
import http from "k6/http";
import { Rate, Trend } from "k6/metrics";

import { meta } from "./meta";

const [ORDER, WAIT] = meta.steps;

const ticketVisible = new Trend("btb_ticket_visible", true);
const ticketOnTime = new Rate("btb_ticket_on_time");

export function run({ http: target, params }: JourneyContext) {
  const eventId = String(params.eventId);
  const pollSec = Number(params.pollIntervalSec);
  const deadlineMs = Number(params.deadlineSec) * 1000;
  let orderId = "";
  let orderedAt = 0;

  group(ORDER, () => {
    const res = target.postJson("/orders", { eventId, qty: 1 }, { tags: { name: "POST /orders" }, responseCallback: http.expectedStatuses(201, 409) });
    check(res, { "order 201 or 409": (r) => r.status === 201 || r.status === 409 });
    if (res.status === 201) {
      orderId = String(res.json("orderId"));
      orderedAt = Date.now();
    }
  });

  if (orderId) {
    group(WAIT, () => {
      let issued = false;
      while (!issued && Date.now() - orderedAt < deadlineMs) {
        const res = target.get(`/orders/${encodeURIComponent(orderId)}/ticket`, { tags: { name: "GET /orders/:id/ticket" } });
        issued = res.status === 200 && res.json("status") === "issued";
        if (!issued) sleep(pollSec);
      }
      if (issued) ticketVisible.add(Date.now() - orderedAt);
      ticketOnTime.add(issued);
      check(null, { "ticket viewable before the deadline": () => issued });
    });
  }

  const think = Number(params.thinkTimeSec);
  if (think > 0) sleep(think);
}
