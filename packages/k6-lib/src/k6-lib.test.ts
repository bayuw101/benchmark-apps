import type { RunManifest, RunnerConfig, RunnerManifestReply } from "@btb/contracts";
import { runnerArtifactOf } from "@btb/contracts";
import { describe, expect, it } from "vitest";

import { consoleKind, ErrorLog, ERRORS_EVERY_MS, errorsName, FAIL_SHOTS_PER_STEP, MAX_ERRORS, screenshotName, ShotPlan, UNCAUGHT_PREFIX } from "./evidence";
import { finalCallback, leaseStep, methodAllowed, parseRunnerConfig, pathAllowed, summaryFacts, targetAllowed, verifyProblems } from "./guard";
import { optionsOf, scenarioOf } from "./options";
import { parseIdentities, segmentSlice } from "./testdata";

const HASH = "a".repeat(64);

const base: RunnerConfig = {
  runId: "RUN-0001",
  manifestHash: HASH,
  manifestUrl: "http://platform.btb-system.svc.cluster.local/api/runner/manifest",
  callbackUrl: "http://platform.btb-system.svc.cluster.local/api/runner/callback",
  journey: "checkout",
  params: { eventId: "evt-1" },
  model: "vus",
  load: 10,
  durationSec: 120,
  rampSec: 30,
  thresholds: { p95Ms: 500, errorRatePct: 1 },
  targetUrl: "http://mock-target.targets.svc.cluster.local:3000",
  allowedHosts: ["mock-target.targets.svc.cluster.local:3000"],
  allowedPaths: ["/events", "/orders"],
  allowedMethods: ["GET", "POST"],
  runners: 2,
  lease: { url: "http://platform.btb-system.svc.cluster.local/api/runner/lease", token: "t", everySec: 10, graceSec: 60 },
  browser: null,
  testData: null,
};

describe("parseRunnerConfig", () => {
  it("accepts a valid config", () => {
    expect(parseRunnerConfig(JSON.stringify(base))).toEqual(base);
  });

  it("rejects missing or broken input", () => {
    expect(() => parseRunnerConfig(undefined)).toThrow(/missing/);
    expect(() => parseRunnerConfig("{")).toThrow(/JSON/);
  });

  it("lists every invalid field", () => {
    const bad = { ...base, load: 0, rampSec: 500, journey: "../x" };
    expect(() => parseRunnerConfig(JSON.stringify(bad))).toThrow("runner config invalid: journey, load, rampSec");
  });

  it("rejects a target outside the allowlist", () => {
    const bad = { ...base, targetUrl: "http://evil.example.com" };
    expect(() => parseRunnerConfig(JSON.stringify(bad))).toThrow(/targetUrl/);
  });

  it("requires a lease", () => {
    expect(() => parseRunnerConfig(JSON.stringify({ ...base, lease: undefined }))).toThrow(/lease/);
    expect(() => parseRunnerConfig(JSON.stringify({ ...base, lease: { ...base.lease, graceSec: 5 } }))).toThrow(/lease/);
  });

  it("requires the self-check fields", () => {
    const bad = { ...base, manifestHash: "abc", manifestUrl: "file:///x", callbackUrl: undefined };
    expect(() => parseRunnerConfig(JSON.stringify(bad))).toThrow("runner config invalid: manifestHash, manifestUrl, callbackUrl");
  });

  it("checks the browser block", () => {
    const browser = { vus: 2, network: "stadium-4g", artifactsUrl: "http://platform.btb-system.svc.cluster.local/api/runner/artifacts" };
    expect(parseRunnerConfig(JSON.stringify({ ...base, browser })).browser).toEqual(browser);
    expect(() => parseRunnerConfig(JSON.stringify({ ...base, browser: { ...browser, network: "5g" } }))).toThrow(/browser/);
    expect(() => parseRunnerConfig(JSON.stringify({ ...base, browser: { ...browser, vus: 0 } }))).toThrow(/browser/);
    expect(() => parseRunnerConfig(JSON.stringify({ ...base, browser: { ...browser, artifactsUrl: "file:///x" } }))).toThrow(/browser/);
    expect(() => parseRunnerConfig(JSON.stringify({ ...base, browser: undefined }))).toThrow(/browser/);
  });
});

describe("lease", () => {
  const t0 = 1_000_000;
  it("carries on while the platform says continue", () => {
    expect(leaseStep(200, '{"action":"continue"}', t0, t0 - 50_000, 60)).toEqual({ ok: true });
  });
  it("aborts on stop", () => {
    expect(leaseStep(200, '{"action":"stop","reason":"run ended"}', t0, t0, 60)).toEqual({ abort: "lease: run ended" });
  });
  it("tolerates failures inside the grace period, then aborts", () => {
    expect(leaseStep(0, null, t0, t0 - 30_000, 60)).toEqual({ ok: false });
    expect(leaseStep(503, "x", t0, t0 - 61_000, 60)).toHaveProperty("abort");
  });
});

describe("self-check", () => {
  const manifest: RunManifest = {
    projectId: "p",
    scenario: { name: "Checkout", journey: "checkout", version: 1, imageVersion: "0.1.0-abc" },
    params: { eventId: "evt-1" },
    environment: "staging",
    target: "mock-target",
    preset: "smoke",
    load: { model: "vus", target: 10, durationSec: 120, rampSec: 30 },
    network: null,
    thresholds: { p95Ms: 500, errorRatePct: 1, abortOnFail: true },
    releaseId: null,
  };
  const allowlist = { hosts: base.allowedHosts, paths: base.allowedPaths, methods: base.allowedMethods };
  const reply: RunnerManifestReply = { manifest, manifestHash: HASH, approved: true, allowlist };

  it("passes when the approved manifest is the config", () => {
    expect(verifyProblems(base, reply, HASH)).toEqual([]);
  });

  it("refuses a changed manifest, a different hash or no approval", () => {
    expect(verifyProblems(base, reply, "b".repeat(64))).toEqual(["stored manifest doesn't match its approved hash"]);
    expect(verifyProblems({ ...base, manifestHash: "c".repeat(64) }, reply, HASH)).toEqual(["approved hash isn't the one this runner was started with"]);
    expect(verifyProblems(base, { ...reply, approved: false }, HASH)).toEqual(["manifest isn't approved"]);
  });

  it("refuses a config that isn't the manifest", () => {
    const m = { ...manifest, params: { eventId: "evt-2" }, load: { ...manifest.load, target: 50 }, network: "stadium-4g" as const };
    expect(verifyProblems(base, { ...reply, manifest: m }, HASH)).toEqual(["config differs from the manifest: params, load, network"]);
    expect(verifyProblems(base, { ...reply, manifest: { ...manifest, thresholds: null } }, HASH)).toEqual(["config differs from the manifest: thresholds"]);
    expect(verifyProblems(base, { ...reply, manifest: {} as RunManifest }, HASH)).toEqual(["manifest unreadable"]);
  });

  it("refuses an allowlist wider than the target's", () => {
    const narrow = { ...allowlist, hosts: ["other:3000"], methods: ["GET"] };
    expect(verifyProblems(base, { ...reply, allowlist: narrow }, HASH)).toEqual(["allowlist wider than the target's", "target host not on the target's allowlist"]);
  });

  it("reads thresholds and iterations from the summary", () => {
    const ok = { metrics: { iterations: { values: { count: 41.9 } }, http_req_duration: { thresholds: { "p(95)<500": { ok: true } } } } };
    expect(summaryFacts(ok)).toEqual({ thresholdsOk: true, iterations: 42 });
    expect(summaryFacts({ metrics: { http_req_failed: { thresholds: { "rate<0.01": { ok: false } } } } })).toEqual({ thresholdsOk: false });
  });

  it("reports a pod cut off mid-run as stopped, not finished", () => {
    const held = { metrics: { iterations: { values: { count: 10 } } } };
    expect(finalCallback({ ...held, state: { testRunDurationMs: 27_400 } }, 120)).toEqual({ event: "stopped", reason: "interrupted after 27 s of the planned 120 s" });
    expect(finalCallback({ ...held, state: { testRunDurationMs: 121_000 } }, 120)).toEqual({ event: "finished", thresholdsOk: true, iterations: 10 });
    expect(finalCallback(held, 120).event).toBe("finished");
    // A threshold abort ends early too, and is a real result.
    const crossed = { metrics: { http_req_failed: { thresholds: { "rate<0.01": { ok: false } } } }, state: { testRunDurationMs: 40_000 } };
    expect(finalCallback(crossed, 120)).toEqual({ event: "finished", thresholdsOk: false });
  });
});

describe("allowlist", () => {
  it("matches host and port exactly", () => {
    expect(targetAllowed("http://a.svc.cluster.local:3000", ["a.svc.cluster.local:3000"])).toBe(true);
    expect(targetAllowed("http://a.svc.cluster.local:3001", ["a.svc.cluster.local:3000"])).toBe(false);
    expect(targetAllowed("https://a.example.com/path", ["a.example.com"])).toBe(false);
    expect(targetAllowed("http://user@evil.com", ["evil.com"])).toBe(false);
  });

  it("matches path prefixes on segment boundaries", () => {
    const allowed = ["/events", "/orders/"];
    expect(pathAllowed("/events", allowed)).toBe(true);
    expect(pathAllowed("/events/evt-1?x=1", allowed)).toBe(true);
    expect(pathAllowed("/orders", allowed)).toBe(true);
    expect(pathAllowed("/eventsx", allowed)).toBe(false);
    expect(pathAllowed("/admin", allowed)).toBe(false);
  });

  it("rejects paths that could escape the target", () => {
    expect(pathAllowed("//evil.com/events", ["/"])).toBe(false);
    expect(pathAllowed("/events/../__admin/reset", ["/events"])).toBe(false);
    expect(pathAllowed("events", ["/events"])).toBe(false);
    expect(pathAllowed("/events\\..", ["/events"])).toBe(false);
  });

  it("matches methods case-insensitively", () => {
    expect(methodAllowed("get", ["GET"])).toBe(true);
    expect(methodAllowed("DELETE", ["GET", "POST"])).toBe(false);
  });
});

describe("options", () => {
  it("ramps then holds the closed model", () => {
    expect(scenarioOf(base)).toMatchObject({
      executor: "ramping-vus",
      stages: [
        { duration: "30s", target: 10 },
        { duration: "90s", target: 10 },
      ],
    });
  });

  it("uses constant executors without a ramp", () => {
    expect(scenarioOf({ ...base, rampSec: 0 })).toMatchObject({ executor: "constant-vus", vus: 10, duration: "120s" });
    expect(scenarioOf({ ...base, model: "rps", rampSec: 0 })).toMatchObject({ executor: "constant-arrival-rate", rate: 10, timeUnit: "1s" });
  });

  it("uses an arrival rate for the open model", () => {
    expect(scenarioOf({ ...base, model: "rps" })).toMatchObject({ executor: "ramping-arrival-rate", startRate: 0, preAllocatedVUs: 10, maxVUs: 30 });
  });

  it("aborts on journey thresholds after the warm-up delay", () => {
    expect(optionsOf(base).thresholds).toEqual({
      "http_req_duration{scenario:checkout}": [{ threshold: "p(95)<500", abortOnFail: true, delayAbortEval: "30s" }],
      "http_req_failed{scenario:checkout}": [{ threshold: "rate<0.01", abortOnFail: true, delayAbortEval: "30s" }],
    });
    expect(optionsOf({ ...base, thresholds: null }).thresholds).toBeUndefined();
  });

  it("adds one lease VU per runner pod", () => {
    expect(optionsOf(base).scenarios?.["btb-lease"]).toMatchObject({ executor: "constant-vus", vus: 2, duration: "120s", exec: "lease" });
  });

  it("adds a Chromium scenario only for browser runs", () => {
    expect(optionsOf(base).scenarios?.["btb-browser"]).toBeUndefined();
    expect(optionsOf({ ...base, browser: { vus: 2, network: "wifi-baseline", artifactsUrl: "http://p/a" } }).scenarios?.["btb-browser"]).toMatchObject({
      executor: "constant-vus",
      vus: 2,
      exec: "browser",
      options: { browser: { type: "chromium" } },
    });
  });
});

describe("browser evidence", () => {
  it("names files the platform accepts", () => {
    expect(screenshotName("Event page", 3, null)).toBe("screenshot-event-page-vu3-ok.png");
    expect(runnerArtifactOf(screenshotName("Event page", 3, null))).toEqual({ label: "Screenshot, event-page (browser VU 3)", contentType: "image/png" });
    expect(runnerArtifactOf(screenshotName("Pay / confirm!", 12, 2))?.label).toBe("Screenshot, pay-confirm failed (browser VU 12, #2)");
    expect(runnerArtifactOf(errorsName(1))).toEqual({ label: "Browser errors, VU 1", contentType: "application/json" });
    expect(runnerArtifactOf("../runner-1.log")).toBeNull();
    expect(runnerArtifactOf("k6-summary-1.json")).toBeNull();
  });

  it("keeps console errors and uncaught page errors only", () => {
    expect(consoleKind("log", "hi")).toBeNull();
    expect(consoleKind("error", "Failed to load resource")).toEqual({ kind: "console", text: "Failed to load resource" });
    expect(consoleKind("error", `${UNCAUGHT_PREFIX}boom`)).toEqual({ kind: "page", text: "boom" });
  });

  it("counts repeats, caps distinct errors and throttles count-only uploads", () => {
    const log = new ErrorLog();
    expect(log.due(0)).toBe(false);
    log.add("Event page", "console", "x", 1000);
    expect(log.due(1000)).toBe(true);
    log.take("RUN-1", 1, 1000);
    log.add("Event page", "console", "x", 2000);
    expect(log.due(2000)).toBe(false);
    expect(log.due(1000 + ERRORS_EVERY_MS)).toBe(true);
    for (let i = 0; i < MAX_ERRORS + 5; i++) log.add("Event page", "page", `e${i}`, 3000);
    const file = log.take("RUN-1", 1, 3000);
    expect(file.errors).toHaveLength(MAX_ERRORS);
    expect(file.errors[0]).toMatchObject({ count: 2, firstAt: new Date(1000).toISOString(), lastAt: new Date(2000).toISOString() });
    expect(file.dropped).toBe(6);
  });

  it("shoots each step's first success and its first few failures", () => {
    const plan = new ShotPlan();
    expect(plan.next("A", 1, false)).toBe("screenshot-a-vu1-ok.png");
    expect(plan.next("A", 1, false)).toBeNull();
    const fails = Array.from({ length: FAIL_SHOTS_PER_STEP + 1 }, () => plan.next("A", 1, true));
    expect(fails).toEqual(["screenshot-a-vu1-fail1.png", "screenshot-a-vu1-fail2.png", "screenshot-a-vu1-fail3.png", null]);
  });
});

describe("test data (E2.6)", () => {
  it("accepts only a Secret name and pool size in the config", () => {
    expect(() => parseRunnerConfig(JSON.stringify({ ...base, testData: { secret: "btb-test-data-mock-target", total: 40 } }))).not.toThrow();
    expect(() => parseRunnerConfig(JSON.stringify({ ...base, testData: { secret: "x", total: 0 } }))).toThrow(/testData/);
    expect(() => parseRunnerConfig(JSON.stringify({ ...base, testData: { secret: "Bad Name", total: 3 } }))).toThrow(/testData/);
  });

  it("reads the mounted identities or says what's wrong", () => {
    expect(parseIdentities('[{"user":"a"},{"user":"b"}]')).toEqual({ identities: [{ user: "a" }, { user: "b" }] });
    expect(parseIdentities(null)).toEqual({ problem: "isn't mounted" });
    expect(parseIdentities("[]")).toHaveProperty("problem");
    expect(parseIdentities("{")).toHaveProperty("problem");
  });

  it("splits identities by execution segment with no overlap", () => {
    const all = Array.from({ length: 10 }, (_, i) => i);
    const parts = ["0:1/3", "1/3:2/3", "2/3:1"].map((s) => segmentSlice(all, s));
    expect(parts.flat()).toEqual(all);
    expect(segmentSlice(all, undefined)).toEqual(all);
    expect(segmentSlice(all, "0.5:1")).toEqual([5, 6, 7, 8, 9]);
  });
});
