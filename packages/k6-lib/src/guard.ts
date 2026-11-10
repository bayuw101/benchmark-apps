import { canonicalJson, type LeaseReply, type RunManifest, type RunnerConfig, type RunnerManifestReply } from "@btb/contracts";

import { THROTTLE } from "./options";

/*
 * Runner-side guardrails (defence in depth behind policy and NetworkPolicy, PRD E2.1/E0.5).
 * Pure functions: no k6 imports, so they are unit-tested in Node.
 */

const URL_RE = /^(https?):\/\/([A-Za-z0-9.-]+(?::\d{1,5})?)$/;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const isNum = (v: unknown, min: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= min;

/** Parses and checks the worker's config. Throws with every problem listed: a bad config must not start load. */
export function parseRunnerConfig(raw: string | undefined): RunnerConfig {
  if (!raw) throw new Error("runner config missing (BTB_RUN_CONFIG)");
  let c: RunnerConfig;
  try {
    c = JSON.parse(raw) as RunnerConfig;
  } catch {
    throw new Error("runner config is not valid JSON");
  }
  const problems: string[] = [];
  if (typeof c.runId !== "string" || !c.runId) problems.push("runId");
  if (typeof c.manifestHash !== "string" || !/^[0-9a-f]{64}$/.test(c.manifestHash)) problems.push("manifestHash");
  if (typeof c.manifestUrl !== "string" || !/^https?:\/\//.test(c.manifestUrl)) problems.push("manifestUrl");
  if (typeof c.callbackUrl !== "string" || !/^https?:\/\//.test(c.callbackUrl)) problems.push("callbackUrl");
  if (typeof c.journey !== "string" || !ID_RE.test(c.journey)) problems.push("journey");
  if (!c.params || typeof c.params !== "object" || Array.isArray(c.params)) problems.push("params");
  if (c.model !== "vus" && c.model !== "rps") problems.push("model");
  if (!isNum(c.load, 1)) problems.push("load");
  if (!isNum(c.durationSec, 1)) problems.push("durationSec");
  if (!isNum(c.rampSec, 0) || c.rampSec > c.durationSec) problems.push("rampSec");
  if (c.thresholds !== null && !(c.thresholds && isNum(c.thresholds.p95Ms, 1) && isNum(c.thresholds.errorRatePct, 0))) problems.push("thresholds");
  if (!isStrings(c.allowedHosts) || !isStrings(c.allowedPaths) || !isStrings(c.allowedMethods)) problems.push("allowlist");
  else if (typeof c.targetUrl !== "string" || !targetAllowed(c.targetUrl, c.allowedHosts)) problems.push("targetUrl");
  if (!Number.isInteger(c.runners) || c.runners < 1) problems.push("runners");
  const b = c.browser;
  const browserOk = b && Number.isInteger(b.vus) && b.vus >= 1 && typeof b.network === "string" && Object.keys(THROTTLE).includes(b.network);
  if (b !== null && !(browserOk && typeof b.artifactsUrl === "string" && /^https?:\/\//.test(b.artifactsUrl))) problems.push("browser");
  const td = c.testData;
  if (td !== null && !(td && typeof td.secret === "string" && /^[a-z0-9.-]{1,253}$/.test(td.secret) && Number.isInteger(td.total) && td.total >= 1)) problems.push("testData");
  const l = c.lease;
  if (!l || typeof l.url !== "string" || !/^https?:\/\//.test(l.url) || typeof l.token !== "string" || !l.token || !isNum(l.everySec, 1) || !isNum(l.graceSec, l.everySec ?? 1)) {
    problems.push("lease");
  }
  if (problems.length) throw new Error(`runner config invalid: ${problems.join(", ")}`);
  return c;
}

/** scheme://host[:port] with the host (and port, if any) on the allowlist. */
export function targetAllowed(url: string, hosts: string[]): boolean {
  const m = URL_RE.exec(url);
  return !!m && hosts.map((h) => h.toLowerCase()).includes(m[2].toLowerCase());
}

/** A request path the target allowlist covers. Rejects anything that could leave the path (`//`, `..`, backslash). */
export function pathAllowed(path: string, allowed: string[]): boolean {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || /(^|\/)\.\.(\/|$|\?)/.test(path)) return false;
  const bare = path.split(/[?#]/, 1)[0];
  return allowed.some((p) => {
    const prefix = p.endsWith("/") ? p.slice(0, -1) : p;
    return prefix === "" || bare === prefix || bare.startsWith(`${prefix}/`);
  });
}

export function methodAllowed(method: string, allowed: string[]): boolean {
  return allowed.includes(method.toUpperCase());
}

const subset = (a: string[], b: string[]) => a.every((x) => b.includes(x));

/**
 * The runner's self-check before load (E5.3): the platform's manifest must hash to the approved hash (computed
 * here, not trusted), be approved, and be exactly what this pod was configured with; the config's allowlist must
 * be within the target's. Returns the problems; empty = go.
 */
export function verifyProblems(c: RunnerConfig, reply: RunnerManifestReply, computedHash: string): string[] {
  const problems: string[] = [];
  if (computedHash !== reply.manifestHash) problems.push("stored manifest doesn't match its approved hash");
  if (reply.manifestHash !== c.manifestHash) problems.push("approved hash isn't the one this runner was started with");
  if (!reply.approved) problems.push("manifest isn't approved");
  try {
    const m: RunManifest = reply.manifest;
    const differs: string[] = [];
    if (m.scenario.journey !== c.journey) differs.push("journey");
    if (canonicalJson(m.params) !== canonicalJson(c.params)) differs.push("params");
    if (m.load.model !== c.model || m.load.target !== c.load || m.load.durationSec !== c.durationSec || m.load.rampSec !== c.rampSec) differs.push("load");
    const th = m.thresholds ? { p95Ms: m.thresholds.p95Ms, errorRatePct: m.thresholds.errorRatePct } : null;
    if (canonicalJson(th) !== canonicalJson(c.thresholds)) differs.push("thresholds");
    if ((m.network ?? null) !== (c.browser?.network ?? null)) differs.push("network");
    if (differs.length) problems.push(`config differs from the manifest: ${differs.join(", ")}`);
  } catch {
    problems.push("manifest unreadable");
  }
  const a = reply.allowlist;
  if (!subset(c.allowedHosts, a.hosts) || !subset(c.allowedPaths, a.paths) || !subset(c.allowedMethods, a.methods)) problems.push("allowlist wider than the target's");
  if (!targetAllowed(c.targetUrl, a.hosts)) problems.push("target host not on the target's allowlist");
  return problems;
}

export type LeaseStep = { abort: string } | { ok: boolean };

/** The parts of k6's handleSummary data the runner reads; setup_data is what setup() returned (none if it aborted). */
export interface SummaryData {
  metrics?: Record<string, { thresholds?: Record<string, { ok?: boolean }>; values?: Record<string, number> }>;
  setup_data?: { verified?: boolean };
  state?: { testRunDurationMs?: number };
}

/** From handleSummary's data: did every threshold hold, how many iterations this pod ran. */
export function summaryFacts(data: SummaryData): { thresholdsOk: boolean; iterations?: number } {
  const metrics = data.metrics ?? {};
  const thresholdsOk = Object.values(metrics).every((m) => Object.values(m.thresholds ?? {}).every((t) => t.ok !== false));
  const count = metrics.iterations?.values?.count;
  return typeof count === "number" ? { thresholdsOk, iterations: Math.round(count) } : { thresholdsOk };
}

/** A pod that ran this much shorter than planned, with its thresholds holding, was cut off (SIGTERM, deleted pod, abort). */
export const INTERRUPTED_MARGIN_SEC = 5;

/**
 * The pod's last callback, from handleSummary. k6 runs handleSummary on SIGTERM too, so a pod that was killed
 * mid-run would otherwise report "finished, thresholds held". A threshold abort also ends early: that one is a
 * real result and stays `finished` with `thresholdsOk: false`.
 */
export function finalCallback(data: SummaryData, durationSec: number): { event: "finished"; thresholdsOk: boolean; iterations?: number } | { event: "stopped"; reason: string } {
  const facts = summaryFacts(data);
  const ranMs = data.state?.testRunDurationMs;
  if (facts.thresholdsOk && typeof ranMs === "number" && ranMs < (durationSec - INTERRUPTED_MARGIN_SEC) * 1000) {
    return { event: "stopped", reason: `interrupted after ${Math.round(ranMs / 1000)} s of the planned ${durationSec} s` };
  }
  return { event: "finished", ...facts };
}

/** What one lease check-in means: abort on "stop" or after `graceSec` without a good answer, else carry on. */
export function leaseStep(status: number, body: string | null, nowMs: number, lastOkMs: number, graceSec: number): LeaseStep {
  let reply: LeaseReply | null = null;
  if (status === 200 && body) {
    try {
      reply = JSON.parse(body) as LeaseReply;
    } catch {
      reply = null;
    }
  }
  if (reply?.action === "stop") return { abort: `lease: ${reply.reason}` };
  if (reply?.action === "continue") return { ok: true };
  if (nowMs - lastOkMs > graceSec * 1000) return { abort: `lease: no answer from the platform for ${graceSec}s` };
  return { ok: false };
}
