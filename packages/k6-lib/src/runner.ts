import { canonicalJson, RUNNER_SIGNATURE_HEADER, type RunnerCallback, type RunnerConfig, type RunnerEvent, type RunnerManifestReply } from "@btb/contracts";
import crypto from "k6/crypto";
import exec from "k6/execution";
import http from "k6/http";

import { verifyProblems } from "./guard";

/** Request names of the runner's own platform calls; the worker's PromQL leaves `btb-*` out of the results. */
const VERIFY_NAME = "btb-verify";
const CALLBACK_NAME = "btb-callback";

/** k6-operator names runner pods' hosts `<testrun>-<index>`. */
const podName = () => (__ENV.HOSTNAME || "local").toLowerCase().slice(0, 63);

/** Signed report to the platform (E5.4). Best effort: a lost callback only costs the second result signal. */
export function sendCallback(c: RunnerConfig, event: RunnerEvent, extra: Pick<RunnerCallback, "reason" | "thresholdsOk" | "iterations"> = {}) {
  const reason = extra.reason?.slice(0, 300);
  const body = JSON.stringify({ runId: c.runId, pod: podName(), event, ...extra, reason });
  http.post(c.callbackUrl, body, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${c.lease.token}`,
      [RUNNER_SIGNATURE_HEADER]: crypto.hmac("sha256", c.lease.token, body, "hex"),
    },
    tags: { name: CALLBACK_NAME },
    timeout: "3s",
    responseCallback: http.expectedStatuses(200),
  });
}

/**
 * Call from setup() and return its result: no load starts unless the platform's approved manifest is this pod's
 * config (E5.3). `local` are problems the pod found itself (e.g. its test-data Secret isn't mounted).
 */
export function verifyRun(c: RunnerConfig, local: string[] = []): { verified: true } {
  const url = `${c.manifestUrl}?runId=${encodeURIComponent(c.runId)}`;
  const res = http.get(url, {
    headers: { Authorization: `Bearer ${c.lease.token}` },
    tags: { name: VERIFY_NAME },
    timeout: "10s",
    responseCallback: http.expectedStatuses(200),
  });
  let problems: string[];
  if (res.status !== 200 || typeof res.body !== "string") {
    problems = [`manifest endpoint answered ${res.status}`];
  } else {
    try {
      const reply = JSON.parse(res.body) as RunnerManifestReply;
      problems = verifyProblems(c, reply, crypto.sha256(canonicalJson(reply.manifest), "hex"));
    } catch {
      problems = ["manifest reply unreadable"];
    }
  }
  problems = [...problems, ...local];
  if (!problems.length) {
    sendCallback(c, "verified");
    return { verified: true };
  }
  const reason = problems.join("; ");
  sendCallback(c, "refused", { reason });
  exec.test.abort(`self-check: ${reason}`);
  throw new Error("unreachable: the test was aborted");
}
