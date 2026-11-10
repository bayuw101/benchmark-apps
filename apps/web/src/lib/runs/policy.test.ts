import { describe, expect, it } from "vitest";
import { ticketing } from "./test-catalog";
import { evaluatePlan, type RunPlanInput } from "@btb/core/policy";

const base: RunPlanInput = { scenario: "Checkout", version: 4, environment: "staging", target: "tickets-staging", preset: "peak" };
const rules = (input: RunPlanInput) => evaluatePlan(ticketing, input).violations.map((v) => `${v.field}:${v.rule}`);

describe("run plan policy", () => {
  it("lists every missing required field", () => {
    expect(rules({})).toEqual(["scenario:required", "environment:required", "target:required", "preset:required"]);
  });

  it("scales load from the reference peak and auto-approves routine staging runs", () => {
    const { violations, plan } = evaluatePlan(ticketing, base);
    expect(violations).toEqual([]);
    expect(plan).toMatchObject({ load: 1200, model: "vus", approvers: 0 });
    expect(evaluatePlan(ticketing, { ...base, preset: "smoke" }).plan?.load).toBe(5);
  });

  it("needs 1 approver for risky presets on staging and 2 for anything on prod-like", () => {
    expect(evaluatePlan(ticketing, { ...base, preset: "soak" }).plan?.approvers).toBe(1);
    expect(evaluatePlan(ticketing, { ...base, environment: "prod-like", target: "tickets-prodlike" }).plan?.approvers).toBe(2);
  });

  it("reports every broken limit at once", () => {
    // gate-api-staging: 3,000 RPS reference peak; Scan ticket is an arrival-rate scenario. Spike = 15,000 RPS in 1 minute.
    expect(rules({ ...base, scenario: "Scan ticket", version: 3, target: "gate-api-staging", preset: "spike" })).toEqual(["preset:rps_ceiling", "preset:ramp_rate"]);
    expect(rules({ ...base, environment: "prod-like", target: "tickets-prodlike", preset: "soak" })).toEqual(
      expect.arrayContaining(["preset:staging_only", "preset:duration"]),
    );
  });

  it("rejects a target outside the environment, a version without thresholds and a bad Release ID", () => {
    expect(rules({ ...base, environment: "prod-like" })).toEqual(["target:not_allowed"]);
    expect(rules({ ...base, scenario: "Scan ticket", version: 1 })).toEqual(["version:missing_thresholds"]);
    expect(rules({ ...base, releaseId: "2026.11.1" })).toEqual([]);
    expect(rules({ ...base, releaseId: "rel 11; drop" })).toEqual(["releaseId:format"]);
  });

  it("refuses a version whose runner image can't run the self-check", () => {
    const old = structuredClone(ticketing);
    old.scenarios.find((s) => s.name === "Checkout")!.versions.find((v) => v.version === 4)!.runnerProtocol = 1;
    expect(evaluatePlan(old, base).violations.map((v) => `${v.field}:${v.rule}`)).toEqual(["version:outdated_runner"]);
  });

  it("asks for a network profile only when the scenario has browser steps", () => {
    expect(rules({ ...base, scenario: "Browse event", version: 6 })).toEqual(["network:required"]);
    expect(evaluatePlan(ticketing, { ...base, scenario: "Browse event", version: 6, network: "stadium-4g" }).plan?.network).toBe("stadium-4g");
    expect(evaluatePlan(ticketing, { ...base, network: "stadium-4g" }).plan?.network).toBeNull();
  });
});
