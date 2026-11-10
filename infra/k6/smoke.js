import http from "k6/http";
import { check, sleep } from "k6";

// Hard allowlist: this script may only hit the local mock target.
const ALLOWED_TARGETS = [
  "http://mock-target:3000",
  "http://mock-target.targets.svc.cluster.local:3000",
];
const BASE = __ENV.TARGET_URL || "http://mock-target:3000";
if (!ALLOWED_TARGETS.includes(BASE)) {
  throw new Error(`Target not allowed: ${BASE}`);
}

export const options = {
  vus: Number(__ENV.VUS || 2),
  duration: __ENV.DURATION || "15s",
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500"],
    checks: ["rate>0.99"],
  },
};

export default function () {
  const event = http.get(`${BASE}/events/evt-1`, { tags: { name: "GET /events/:id" } });
  check(event, { "event 200": (r) => r.status === 200 });

  const order = http.post(`${BASE}/orders`, JSON.stringify({ eventId: "evt-1", qty: 1 }), {
    headers: { "Content-Type": "application/json" },
    tags: { name: "POST /orders" },
    // 409 (sold out) is a valid business response, not a transport failure.
    responseCallback: http.expectedStatuses(201, 409),
  });
  check(order, { "order 201 or 409": (r) => r.status === 201 || r.status === 409 });

  sleep(1);
}
