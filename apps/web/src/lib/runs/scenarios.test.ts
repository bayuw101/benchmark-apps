import { describe, expect, it } from "vitest";
import { ticketing } from "./test-catalog";
import { diffVersion, validateScenario } from "./scenarios";

const rules = (input: Parameters<typeof validateScenario>[1]) => validateScenario(ticketing, input).violations.map((v) => `${v.field}:${v.rule}`);

describe("scenario versions", () => {
  it("requires a name, journey, load model and both abort thresholds for a new scenario", () => {
    expect(rules({})).toEqual(["name:required", "journey:required", "model:required", "p95Ms:range", "errorRatePct:range"]);
  });

  it("checks parameters against the journey's schema", () => {
    const base = { name: "Big checkout", journey: "checkout", model: "vus", p95Ms: 800, errorRatePct: 1 };
    expect(rules({ ...base, params: { ticketsPerOrder: 20 } })).toEqual(["params.ticketsPerOrder:range"]);
    expect(rules({ ...base, params: { nope: 1 } })).toEqual(["params.nope:unknown"]);
    expect(rules({ ...base, params: { retryOnDrop: "yes" } })).toEqual(["params.retryOnDrop:type"]);
    expect(rules({ ...base, name: "checkout" })).toEqual(["name:taken"]);
    expect(rules(base)).toEqual([]);
  });

  it("refuses a new version that changes nothing (on the current image), and lists what changed", () => {
    const latest = ticketing.scenarios.find((s) => s.name === "Checkout")!.versions[0];
    const same = { scenario: "Checkout", model: latest.model, params: latest.params, p95Ms: latest.thresholds!.p95Ms, errorRatePct: latest.thresholds!.errorRatePct };
    expect(rules(same)).toEqual(["form:no_change"]);
    const { resolved } = validateScenario(ticketing, { ...same, p95Ms: 650 });
    expect(resolved).not.toBeNull();
    expect(diffVersion(latest, { ...resolved!, imageVersion: latest.imageVersion })).toContain(`p95 threshold ${latest.thresholds!.p95Ms} ms → 650 ms`);
  });
});
