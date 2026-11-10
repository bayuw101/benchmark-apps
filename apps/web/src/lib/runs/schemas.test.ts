import { describe, expect, it } from "vitest";
import { canonicalJson } from "@btb/contracts";
import { parseWith, runManifestSchema, runnerCallbackSchema, runPlanInputSchema, scenarioInputSchema, targetInputSchema } from "@btb/contracts/schemas";
import { evaluatePlan, manifestOf } from "@btb/core/policy";

import { ticketing } from "./test-catalog";

const plan = evaluatePlan(ticketing, { scenario: "Checkout", version: 4, environment: "staging", target: "tickets-staging", preset: "peak" }).plan!;
const manifest = manifestOf("p1", plan);

describe("shared zod schemas (PRD E1.2, E3.2)", () => {
  it("run plan input: shape only, unknown keys dropped, policy decides the rest", () => {
    expect(parseWith(runPlanInputSchema, { scenario: "Checkout", version: 4, admin: true })).toEqual({ ok: true, data: { scenario: "Checkout", version: 4 } });
    expect(parseWith(runPlanInputSchema, {})).toEqual({ ok: true, data: {} });
    const bad = parseWith(runPlanInputSchema, { version: 1.5, target: "x".repeat(101) });
    expect(bad.ok ? [] : bad.violations.map((v) => v.field)).toEqual(["version", "target"]);
    expect(parseWith(runPlanInputSchema, null).ok).toBe(false);
  });

  it("manifest: what policy builds fits, anything outside the contract doesn't", () => {
    expect(runManifestSchema.parse(manifest)).toEqual(manifest);
    // Round trip through jsonb keeps the hash input the same.
    expect(canonicalJson(runManifestSchema.parse(JSON.parse(JSON.stringify(manifest))))).toBe(canonicalJson(manifest));
    expect(runManifestSchema.safeParse({ ...manifest, extra: 1 }).success).toBe(false);
    expect(runManifestSchema.safeParse({ ...manifest, thresholds: { p95Ms: 800, errorRatePct: 1, abortOnFail: false } }).success).toBe(false);
    expect(runManifestSchema.safeParse({ ...manifest, preset: "huge" }).success).toBe(false);
    expect(runManifestSchema.safeParse({ ...manifest, load: { ...manifest.load, target: -1 } }).success).toBe(false);
  });

  it("form bodies: numbers may come as typed text, lists as text or arrays", () => {
    expect(parseWith(scenarioInputSchema, { name: "Checkout", p95Ms: "800", errorRatePct: 1, params: { quantity: "2", seated: true } }).ok).toBe(true);
    expect(parseWith(scenarioInputSchema, { params: { quantity: { nested: 1 } } }).ok).toBe(false);
    expect(parseWith(targetInputSchema, { hosts: "a.example.com\nb.example.com", methods: ["GET"], peakVus: "1200" }).ok).toBe(true);
    expect(parseWith(targetInputSchema, { hosts: ["a.example.com"], peakVus: { n: 1 } }).ok).toBe(false);
  });

  it("runner callback: closed event set, bounded reason", () => {
    const ok = { runId: "RUN-7", pod: "run-7-1", event: "finished", thresholdsOk: true, iterations: 12 };
    expect(runnerCallbackSchema.safeParse(ok).success).toBe(true);
    expect(runnerCallbackSchema.safeParse({ ...ok, event: "exploded" }).success).toBe(false);
    expect(runnerCallbackSchema.safeParse({ ...ok, pod: "Bad_Pod" }).success).toBe(false);
    expect(runnerCallbackSchema.safeParse({ ...ok, reason: "x".repeat(301) }).success).toBe(false);
    expect(runnerCallbackSchema.safeParse({ ...ok, iterations: -1 }).success).toBe(false);
  });
});
