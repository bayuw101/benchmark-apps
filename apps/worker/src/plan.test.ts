import type { RunManifest } from "@btb/contracts";
import { describe, expect, it } from "vitest";

import {
  browserQueries,
  browserSteps,
  capacityNeed,
  capacityShortfall,
  caveatsOf,
  clusterService,
  errorRate,
  gapSeconds,
  dockerRunArgs,
  dockerStatus,
  journeyQueries,
  journeySummary,
  kubeStatus,
  lastPushQuery,
  liveQueries,
  outcomeOf,
  parallelismFor,
  parseQuantity,
  runnerConfig,
  saturationNumbers,
  saturationOf,
  saturationQueries,
  schedule,
  splitRunnerLog,
  selfCheckRefusal,
  summaryQueries,
  targetUrl,
  telemetrySilenceSec,
  testRunManifest,
  tokenExpiry,
  TOKEN_SLACK_SEC,
  verdictOf,
  withCallbacks,
  type SummaryNumbers,
} from "./plan";

const manifest: RunManifest = {
  projectId: "arbiter-ticketing",
  scenario: { name: "Checkout", journey: "checkout", version: 1, imageVersion: "0.1.0-abc" },
  params: { eventId: "evt-1" },
  environment: "staging",
  target: "mock-target",
  preset: "smoke",
  load: { model: "vus", target: 5, durationSec: 120, rampSec: 30 },
  network: null,
  thresholds: { p95Ms: 500, errorRatePct: 1, abortOnFail: true },
  releaseId: null,
};
const target = { name: "mock-target", hosts: ["mock-target.targets.svc.cluster.local:3000"], paths: ["/events", "/orders"], methods: ["GET", "POST"] };
const lease = { url: "http://btb-platform.btb-system.svc.cluster.local/api/runner/lease", token: "t", everySec: 10, graceSec: 60 };
const hash = "a".repeat(64);

describe("schedule", () => {
  const q = (id: string, targetId: string, namespace = "perf-staging") => ({ id, targetId, namespace });

  it("starts in order and keeps one active run per target", () => {
    expect(schedule([q("RUN-2", "t1"), q("RUN-3", "t1"), q("RUN-4", "t2")], [], 2)).toEqual([
      { id: "RUN-2", start: true },
      { id: "RUN-3", start: false, behind: "RUN-2" },
      { id: "RUN-4", start: true },
    ]);
  });

  it("waits behind the active run on the same target", () => {
    expect(schedule([q("RUN-2", "t1")], [q("RUN-1", "t1")], 2)).toEqual([{ id: "RUN-2", start: false, behind: "RUN-1" }]);
  });

  it("caps active runs per namespace, other namespaces unaffected", () => {
    const active = [q("RUN-1", "t1"), q("RUN-2", "t2")];
    expect(schedule([q("RUN-3", "t3"), q("RUN-4", "t4", "perf-prod")], active, 2)).toEqual([
      { id: "RUN-3", start: false, behind: "RUN-1" },
      { id: "RUN-4", start: true },
    ]);
  });

  it("lets a later run on a free target pass one waiting for its target", () => {
    expect(schedule([q("RUN-3", "t1"), q("RUN-4", "t2")], [q("RUN-1", "t1")], 2)).toEqual([
      { id: "RUN-3", start: false, behind: "RUN-1" },
      { id: "RUN-4", start: true },
    ]);
  });
});

describe("TestRun", () => {
  it("scales runner pods with load, capped", () => {
    expect(parallelismFor(5, 4)).toBe(1);
    expect(parallelismFor(200, 4)).toBe(1);
    expect(parallelismFor(201, 4)).toBe(2);
    expect(parallelismFor(5000, 4)).toBe(4);
  });

  it("uses http inside the cluster and https elsewhere", () => {
    expect(targetUrl("mock-target.targets.svc.cluster.local:3000")).toBe("http://mock-target.targets.svc.cluster.local:3000");
    expect(targetUrl("api.svc")).toBe("http://api.svc");
    expect(targetUrl("staging-api.arbiter.co")).toBe("https://staging-api.arbiter.co");
    expect(targetUrl("svc.cluster.local.evil.com")).toBe("https://svc.cluster.local.evil.com");
    expect(targetUrl("127.0.0.1:8081")).toBe("http://127.0.0.1:8081");
    expect(targetUrl("localhost.example.com")).toBe("https://localhost.example.com");
  });

  it("builds the runner config from the manifest and the target allowlist", () => {
    expect(runnerConfig("RUN-0009", hash, manifest, target, 2, lease)).toEqual({
      runId: "RUN-0009",
      manifestHash: hash,
      manifestUrl: "http://btb-platform.btb-system.svc.cluster.local/api/runner/manifest",
      callbackUrl: "http://btb-platform.btb-system.svc.cluster.local/api/runner/callback",
      journey: "checkout",
      params: { eventId: "evt-1" },
      model: "vus",
      load: 5,
      durationSec: 120,
      rampSec: 30,
      thresholds: { p95Ms: 500, errorRatePct: 1 },
      targetUrl: "http://mock-target.targets.svc.cluster.local:3000",
      allowedHosts: target.hosts,
      allowedPaths: target.paths,
      allowedMethods: target.methods,
      runners: 2,
      lease,
      browser: null,
      testData: null,
    });
    expect(() => runnerConfig("RUN-1", hash, manifest, { ...target, hosts: [] }, 1, lease)).toThrow();
  });

  it("passes only the test-data Secret's name and mounts it read-only into runner pods (E2.6)", () => {
    const config = runnerConfig("RUN-0009", hash, manifest, target, 2, lease, 40);
    expect(config.testData).toEqual({ secret: "btb-test-data-mock-target", total: 40 });
    const tr = testRunManifest({ runId: "RUN-0009", namespace: "perf-staging", image: "btb-runner:x", parallelism: 2, config, remoteWriteUrl: "http://p/api/v1/write" });
    expect(tr.spec.runner).toMatchObject({
      volumes: [{ name: "test-data", secret: { secretName: "btb-test-data-mock-target", optional: true } }],
      volumeMounts: [{ name: "test-data", mountPath: "/var/run/btb/test-data", readOnly: true }],
    });
    const plain = testRunManifest({ runId: "RUN-0009", namespace: "perf-staging", image: "btb-runner:x", parallelism: 2, config: runnerConfig("RUN-0009", hash, manifest, target, 2, lease), remoteWriteUrl: "http://p/api/v1/write" });
    expect(plain.spec.runner).not.toHaveProperty("volumes");
  });

  it("gives the runner token the run's length plus slack", () => {
    expect(tokenExpiry(1_000_000_500, 120)).toBe(1_000_001 + 120 + TOKEN_SLACK_SEC);
  });

  it("adds browser VUs per pod and bigger runners when the run has a network profile", () => {
    const config = runnerConfig("RUN-0009", hash, { ...manifest, network: "stadium-4g" }, target, 2, lease);
    expect(config.browser).toEqual({ vus: 2, network: "stadium-4g", artifactsUrl: "http://btb-platform.btb-system.svc.cluster.local/api/runner/artifacts" });
    const tr = testRunManifest({ runId: "RUN-0009", namespace: "perf-staging", image: "btb-runner:x", parallelism: 2, config, remoteWriteUrl: "http://p/api/v1/write" });
    expect(tr.spec.runner.resources.limits.memory).toBe("1Gi");
    expect(tr.spec.runner.env).toContainEqual({ name: "GOMEMLIMIT", value: "819MiB" });
  });

  it("labels the TestRun and tags metrics with the run id", () => {
    const config = runnerConfig("RUN-0009", hash, manifest, target, 1, lease);
    const tr = testRunManifest({ runId: "RUN-0009", namespace: "perf-staging", image: "btb-runner:0.1.0-abc", parallelism: 1, config, remoteWriteUrl: "http://p/api/v1/write" });
    expect(tr.metadata).toMatchObject({ name: "run-0009", namespace: "perf-staging", labels: { "btb.io/run-id": "RUN-0009" } });
    expect(tr.spec.arguments).toContain("--tag testid=RUN-0009");
    expect(JSON.parse(tr.spec.runner.env.find((e) => e.name === "BTB_RUN_CONFIG")!.value)).toEqual(config);
  });

  it("refuses run ids that could escape a label or a query", () => {
    expect(() => liveQueries('RUN-1"} or vector(1) #', false)).toThrow();
  });

  it("leaves lease and browser VUs out of the load numbers", () => {
    expect(liveQueries("RUN-1", false).vus).toContain("- 1 * count(");
    expect(liveQueries("RUN-1", true).vus).toContain("- 2 * count(");
    expect(liveQueries("RUN-1", true).rps).toContain('scenario!~"btb-lease|btb-browser",name!~"btb-.*"');
  });
});

describe("runner capacity", () => {
  it("parses quantities", () => {
    expect(parseQuantity("2")).toBe(2);
    expect(parseQuantity("500m")).toBeCloseTo(0.5);
    expect(parseQuantity("128Mi")).toBe(128 * 1024 ** 2);
    expect(parseQuantity("2Gi")).toBe(2 * 1024 ** 3);
  });

  const quota = (used: Record<string, string>) => ({
    hard: { pods: "10", "requests.cpu": "2", "requests.memory": "2Gi", "limits.cpu": "4", "limits.memory": "4Gi" },
    used,
  });

  it("passes with room and names the first short resource", () => {
    expect(capacityShortfall([quota({ pods: "0", "requests.cpu": "0", "requests.memory": "0", "limits.cpu": "0", "limits.memory": "0" })], capacityNeed(4, false))).toBeNull();
    expect(capacityShortfall([quota({ pods: "9" })], capacityNeed(1, false))).toBe("pods: needs 2, 1 free");
    expect(capacityShortfall([quota({ "requests.cpu": "1900m" })], capacityNeed(1, false))).toBe("requests.cpu: needs 200m, 100m free");
  });

  it("sizes browser runners for Chromium", () => {
    expect(capacityNeed(2, true)).toMatchObject({ pods: 3, "limits.memory": 2 * 1024 ** 3 + 256 * 1024 ** 2 });
    expect(capacityShortfall([quota({})], capacityNeed(4, true))).toBe("requests.cpu: needs 2100m, 2000m free");
  });

  it("finds the in-cluster service behind a host", () => {
    expect(clusterService("mock-target.targets.svc.cluster.local:3000")).toEqual({ name: "mock-target", namespace: "targets", port: 3000 });
    expect(clusterService("api.example.com")).toBeNull();
  });
});

describe("outcome and verdict", () => {
  const summary: SummaryNumbers = {
    p50Ms: 80,
    p95Ms: 200,
    p99Ms: 300,
    errorRatePct: 0.2,
    peakRps: 20,
    maxVus: 5,
    achievedLoad: 5,
    achievedDurationSec: 120,
    gapSec: 0,
    browser: null,
    journey: null,
  };

  it("maps runner exit codes", () => {
    expect(outcomeOf([0, 0]).status).toBe("completed");
    expect(outcomeOf([0, 99])).toMatchObject({ status: "aborted", abortReason: "threshold" });
    expect(outcomeOf([0, 108])).toMatchObject({ status: "aborted", abortReason: "lease_expired" });
    expect(outcomeOf([0, 1])).toMatchObject({ status: "failed", abortReason: "kubernetes_failure" });
    expect(outcomeOf([])).toMatchObject({ status: "failed" });
  });

  it("combines exit codes with the runners' own callbacks", () => {
    const cb = (pod: string, event: "verified" | "refused" | "stopped" | "finished", reason?: string) => ({ runId: "RUN-1", pod, event, reason });
    const pods = ["run-1-1-abcde", "run-1-2-fghij"];
    const done = withCallbacks(outcomeOf([0, 0]), [cb("run-1-1", "finished"), cb("run-1-2", "finished")], pods);
    expect(done).toEqual({ outcome: outcomeOf([0, 0]), missing: [] });
    // A refusal exits 108 like a lost lease; the callback says which it was.
    const refused = withCallbacks(outcomeOf([108, 108]), [cb("run-1-1", "refused", "manifest isn't approved")], pods);
    expect(refused.outcome).toMatchObject({ status: "aborted", abortReason: "policy_breach" });
    expect(refused.outcome.detail).toContain("manifest isn't approved");
    expect(refused.missing).toEqual(["run-1-2-fghij"]);
    const stopped = withCallbacks(outcomeOf([108, 0]), [cb("run-1-1", "stopped", "lease: run is stopping")], pods);
    expect(stopped.outcome).toMatchObject({ abortReason: "lease_expired", detail: "A runner stopped the load (lease: run is stopping)." });
    // A pod that reported stopping did report: only the silent pod is missing.
    expect(stopped.missing).toEqual(["run-1-2-fghij"]);
    // run-1-1 must not count as run-1-10.
    expect(withCallbacks(outcomeOf([0]), [cb("run-1-1", "finished")], ["run-1-10-xyz"]).missing).toEqual(["run-1-10-xyz"]);
  });

  it("judges against the manifest thresholds", () => {
    const done = outcomeOf([0]);
    expect(verdictOf(done, summary, manifest.thresholds)).toBe("pass");
    expect(verdictOf(done, { ...summary, p95Ms: 501 }, manifest.thresholds)).toBe("fail");
    expect(verdictOf(done, { ...summary, errorRatePct: 1.5 }, manifest.thresholds)).toBe("fail");
    expect(verdictOf(done, null, manifest.thresholds)).toBeNull();
    expect(verdictOf(outcomeOf([99]), null, manifest.thresholds)).toBe("fail");
    expect(verdictOf({ status: "aborted", abortReason: "emergency_stop" }, summary, manifest.thresholds)).toBeNull();
  });

  it("fails a completed run on any integrity break and drops the caveat once verified", () => {
    const done = { status: "completed", abortReason: null } as const;
    const clean = { oversoldSeats: 0, doubleCharges: 0, chargedNoTicket: 0 };
    expect(verdictOf(done, summary, manifest.thresholds, clean)).toBe("pass");
    expect(verdictOf(done, summary, manifest.thresholds, { ...clean, doubleCharges: 1 })).toBe("fail");
    expect(verdictOf({ status: "aborted", abortReason: "emergency_stop" }, summary, manifest.thresholds, { ...clean, oversoldSeats: 2 })).toBeNull();
    expect(caveatsOf({ status: "completed" }, summary, clean)).toEqual([]);
    expect(caveatsOf({ status: "completed" }, { ...summary, gapSec: 20 }, clean)).toEqual(["measurement_gap"]);
  });

  it("caveats: integrity unverified without counts, gaps from missing pushes", () => {
    expect(caveatsOf({ status: "completed" }, summary)).toEqual(["integrity_not_verified"]);
    expect(caveatsOf({ status: "completed" }, { ...summary, gapSec: 20 })).toEqual(["integrity_not_verified", "measurement_gap"]);
    expect(caveatsOf({ status: "completed" }, null)).toEqual(["measurement_gap"]);
    expect(caveatsOf({ status: "aborted" }, null)).toEqual([]);
    expect(gapSeconds(120, 24)).toBe(0);
    expect(gapSeconds(120, 18)).toBe(20);
  });

  it("error rate in percent, 3 decimals", () => {
    expect(errorRate(1, 3)).toBe(33.333);
    expect(errorRate(0, 0)).toBe(0);
  });

  it("summary uses the arrival rate for the open model", () => {
    expect(summaryQueries("RUN-1", 120, "rps", false).peakLoad).toContain("k6_iterations_total");
    expect(summaryQueries("RUN-1", 120, "vus", false).peakLoad).toContain("k6_vus");
  });

  it("generator saturated: runner CPU at its limit or dropped iterations", () => {
    expect(saturationOf({ cpuPct: 99, droppedPct: 0 })).toMatch(/99% of its CPU limit/);
    expect(saturationOf({ cpuPct: 35, droppedPct: 4.2 })).toMatch(/dropped 4.2%/);
    expect(saturationOf({ cpuPct: null, droppedPct: 1 })).toBeNull();
    expect(saturationOf({ cpuPct: 89, droppedPct: 0.5 })).toBeNull();
    expect(saturationNumbers({ cpuPct: 99.6, dropped: 5, iterations: 95 })).toEqual({ cpuPct: 100, droppedPct: 5 });
    expect(saturationNumbers({ cpuPct: null, dropped: null, iterations: null })).toEqual({ cpuPct: null, droppedPct: 0 });
    expect(caveatsOf({ status: "completed" }, summary, { oversoldSeats: 0, doubleCharges: 0, chargedNoTicket: 0 }, "cpu")).toEqual(["generator_saturated"]);
    const q = saturationQueries("RUN-7", 120, "perf-staging", false);
    expect(q.cpuPct).toBe('max_over_time(max(rate(container_cpu_usage_seconds_total{namespace="perf-staging",pod=~"run-7-[0-9]+-.*",container="k6"}[1m]))[120s:5s]) / 0.5 * 100');
    expect(saturationQueries("RUN-7", 120, null, true).cpuPct).toBeUndefined();
    expect(() => saturationQueries("RUN-7", 120, 'x"}', false)).toThrow();
  });

  it("reads p75 web vitals per browser step", () => {
    const q = browserQueries("RUN-1", 120);
    expect(q.lcpMs).toBe('histogram_quantile(0.75, sum by (name) (last_over_time(k6_browser_web_vital_lcp_seconds{testid="RUN-1",scenario="btb-browser"}[120s]))) * 1000');
    expect(q.cls).not.toContain("* 1000");
    expect(browserSteps({ lcpMs: {}, inpMs: {}, cls: {}, fcpMs: {}, ttfbMs: {} })).toBeNull();
    expect(browserSteps({ lcpMs: { "Event page": 812.4 }, inpMs: {}, cls: { "Event page": 0.01234 }, fcpMs: { "Event page": 640 }, ttfbMs: { "Event page": 3.6 } })).toEqual([
      { step: "Event page", lcpMs: 812, inpMs: null, cls: 0.012, fcpMs: 640, ttfbMs: 4 },
    ]);
  });
});

describe("artifacts", () => {
  it("takes the k6 summary line out of the runner log", () => {
    expect(splitRunnerLog('a\nBTB_K6_SUMMARY {"x":1}\nb')).toEqual({ summary: '{"x":1}', log: "a\nb" });
    expect(splitRunnerLog("a\nb")).toEqual({ summary: null, log: "a\nb" });
  });

  it("reads a self-check refusal from the log when its callback was lost", () => {
    const refused = 'level=error msg="test aborted: self-check: manifest endpoint answered 0 at verifyRun"\nBTB_K6_SUMMARY {"metrics":{}}';
    expect(selfCheckRefusal(refused)).toBe("manifest endpoint answered 0 at verifyRun");
    expect(selfCheckRefusal('BTB_K6_SUMMARY {"setup_data":{"verified":true}}')).toBeNull();
    expect(selfCheckRefusal("no summary line")).toBeNull();
  });
});

describe("telemetry", () => {
  it("counts silence from the newest push, or from when watching began", () => {
    expect(telemetrySilenceSec(100_000, 10_000, 95_000)).toBe(5);
    expect(telemetrySilenceSec(100_000, 10_000, null)).toBe(90);
    // A push older than the start of watching doesn't stretch the silence.
    expect(telemetrySilenceSec(100_000, 70_000, 20_000)).toBe(30);
  });

  it("queries the newest push of the run only", () => {
    expect(lastPushQuery("RUN-7")).toBe('max(timestamp(k6_vus{testid="RUN-7",scenario!~"btb-lease|btb-browser",name!~"btb-.*"}))');
    expect(() => lastPushQuery("RUN-7\"}")).toThrow();
  });
});

describe("journey funnel", () => {
  it("queries the run's btb_* series by step and item", () => {
    const q = journeyQueries("RUN-7", 100);
    expect(q.reached).toBe('sum by (step) (max_over_time(k6_btb_step_reached_total{testid="RUN-7",scenario!~"btb-lease|btb-browser",name!~"btb-.*"}[100s]))');
    expect(q.paymentToConfirmation).toContain("histogram_quantile(0.95, sum (last_over_time(k6_btb_payment_to_confirmation_seconds{");
    expect(q.integrity).toContain("sum by (item)");
  });

  it("orders steps as a funnel and fills integrity counts", () => {
    const s = journeySummary({
      reached: { Payment: 66, Cart: 66, Confirmation: 51 },
      completed: { Payment: 51, Cart: 66, Confirmation: 51 },
      stepP95: { Payment: 2512.4, Cart: 40.2 },
      paymentToConfirmation: 2480.6,
      integrity: { charge: 51, order: 51 },
    });
    expect(s?.steps.map((x) => x.step)).toEqual(["Cart", "Payment", "Confirmation"]);
    expect(s?.steps[1]).toEqual({ step: "Payment", reached: 66, completed: 51, p95Ms: 2512 });
    expect(s?.steps[2].p95Ms).toBeNull();
    expect(s?.paymentToConfirmationP95Ms).toBe(2481);
    expect(s?.counts).toEqual({ order: 51, seat: 0, ticket: 0, charge: 51 });
  });

  it("is null for journeys without funnel metrics, and counts are null without integrity counters", () => {
    expect(journeySummary({ reached: {}, completed: {}, stepP95: {}, paymentToConfirmation: null, integrity: {} })).toBeNull();
    expect(journeySummary({ reached: { A: 1 }, completed: {}, stepP95: {}, paymentToConfirmation: null, integrity: {} })?.counts).toBeNull();
  });
});

describe("executors", () => {
  it("maps TestRun stages and waits for every pod's exit code", () => {
    expect(kubeStatus(null)).toBeNull();
    expect(kubeStatus({ stage: "initialized" })).toEqual({ stage: "pending", runners: [], detail: "stage: initialized" });
    expect(kubeStatus({ stage: "started" })?.stage).toBe("running");
    expect(kubeStatus({ stage: "error" })?.stage).toBe("failed");
    expect(kubeStatus({ stage: "finished" }, [{ name: "a", exitCode: 0 }, { name: "b", exitCode: null }])?.stage).toBe("running");
    expect(kubeStatus({ stage: "finished" }, [{ name: "a", exitCode: 0 }])).toEqual({ stage: "finished", runners: [{ name: "a", exitCode: 0 }] });
  });

  it("fails a started TestRun at once when a runner pod dies or disappears", () => {
    const up = [{ name: "r-1-x", exitCode: null }, { name: "r-2-y", exitCode: null }];
    expect(kubeStatus({ stage: "started", parallelism: 2 }, up)?.stage).toBe("running");
    // A pod done by itself (finished early, thresholds, lease) is not a death.
    expect(kubeStatus({ stage: "started", parallelism: 2 }, [up[0], { name: "r-2-y", exitCode: 108 }])?.stage).toBe("running");
    const oom = kubeStatus({ stage: "started", parallelism: 2 }, [up[0], { name: "r-2-y", exitCode: 137 }]);
    expect(oom?.stage).toBe("failed");
    expect(oom?.detail).toContain("Runner pod r-2-y died (exit 137");
    const gone = kubeStatus({ stage: "started", parallelism: 2 }, [up[0]]);
    expect(gone).toEqual({ stage: "failed", runners: [], detail: "1 of 2 runner pods disappeared (deleted or evicted) before the run ended; any other runners were stopped." });
    // k6-operator flips to finished the moment its only pod is deleted: nothing to wait for.
    expect(kubeStatus({ stage: "finished", parallelism: 1 }, [])?.detail).toBe("1 of 1 runner pod disappeared (deleted or evicted) before the run ended; any other runners were stopped.");
  });

  it("maps Docker containers, reading exit codes from docker ps", () => {
    const row = (Names: string, State: string, Status: string) => ({ Names, State, Status });
    expect(dockerStatus([])).toBeNull();
    expect(dockerStatus([row("run-0009-r1-c", "created", "Created")])?.stage).toBe("pending");
    expect(dockerStatus([row("run-0009-r1-c", "running", "Up 3 seconds")])?.stage).toBe("running");
    expect(dockerStatus([row("run-0009-r1-c", "exited", "Exited (99) 2 seconds ago")])).toEqual({ stage: "finished", runners: [{ name: "run-0009-r1-c", exitCode: 99 }] });
    expect(dockerStatus([row("run-0009-r1-c", "dead", "Dead")])?.stage).toBe("failed");
  });

  it("runs one runner container: labelled, limited, never pulled, callbacks match its name", () => {
    const config = runnerConfig("RUN-0009", hash, manifest, { ...target, hosts: ["127.0.0.1:8081"] }, 1, lease);
    const args = dockerRunArgs({ runId: "RUN-0009", scope: "staging", image: "btb-runner:1.0", runners: 1, config, remoteWriteUrl: "http://127.0.0.1:9090/api/v1/write" }, "host", 1);
    expect(args.slice(0, 3)).toEqual(["run", "--detach", "--pull=never"]);
    expect(args).toContain("--name=run-0009-r1-c");
    expect(args).toContain("--hostname=run-0009-r1");
    expect(args).toContain("--label=btb.io/run-id=RUN-0009");
    expect(args).toContain("--label=btb.io/scope=staging");
    expect(args).toContain("--network=host");
    expect(args).toContain("GOMEMLIMIT=204MiB");
    expect(args).toContain(`BTB_RUN_CONFIG=${JSON.stringify(config)}`);
    expect(args.slice(args.indexOf("btb-runner:1.0"))).toEqual(["btb-runner:1.0", "run", "--tag=testid=RUN-0009", "--out=experimental-prometheus-rw", "/home/k6/btb/main.js"]);
    // withCallbacks matches runners whose name starts with "<hostname>-".
    expect(withCallbacks(outcomeOf([0]), [{ runId: "RUN-0009", pod: "run-0009-r1", event: "finished" }], ["run-0009-r1-c"]).missing).toEqual([]);
  });
});
