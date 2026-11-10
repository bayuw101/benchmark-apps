import type { RunnerConfig } from "@btb/contracts";
import { LEASE_SCENARIO } from "@btb/contracts";
import { sleep } from "k6";
import exec from "k6/execution";
import http from "k6/http";

import { leaseStep } from "./guard";
import { sendCallback } from "./runner";

// Per VU, so per runner pod: the lease scenario has one VU in each.
let lastOkMs = Date.now();

/** One iteration of the lease scenario (E6.1): check in, abort the whole test if the platform says so or is gone. */
export function leaseCheckIn(c: RunnerConfig) {
  const res = http.post(c.lease.url, JSON.stringify({ runId: c.runId }), {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.lease.token}` },
    tags: { name: LEASE_SCENARIO },
    timeout: "5s",
    responseCallback: http.expectedStatuses(200),
  });
  const now = Date.now();
  const step = leaseStep(res.status, typeof res.body === "string" ? res.body : null, now, lastOkMs, c.lease.graceSec);
  if ("abort" in step) {
    sendCallback(c, "stopped", { reason: step.abort });
    exec.test.abort(step.abort);
  } else if (step.ok) lastOkMs = now;
  sleep(c.lease.everySec);
}
