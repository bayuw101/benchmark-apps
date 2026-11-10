import type { JourneyContext } from "@btb/k6-lib";
import { check, group, sleep } from "k6";
import exec from "k6/execution";
import http from "k6/http";

import { meta } from "./meta";

const [SCAN] = meta.steps;

export function run({ http: target, params }: JourneyContext) {
  // Unique across all runner pods, so pods don't scan the same ticket until the pool wraps.
  const ticketId = `gate-${exec.scenario.iterationInTest % Number(params.ticketPool)}`;

  group(SCAN, () => {
    const res = target.postJson(
      "/scan",
      { ticketId, gate: String(params.gate) },
      { tags: { name: "POST /scan" }, responseCallback: http.expectedStatuses(200, 409) },
    );
    check(res, { "scan admitted or already used": (r) => r.status === 200 || r.status === 409 });
  });

  const think = Number(params.thinkTimeSec);
  if (think > 0) sleep(think);
}
