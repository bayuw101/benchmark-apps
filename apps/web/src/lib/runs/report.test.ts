import { describe, expect, it } from "vitest";
import { buildRunDetail } from "./detail";
import { recommendNext, renderReport } from "./report";
import { completedRun } from "./test-catalog";

const NOW = new Date("2026-11-07T10:00:00Z");
const plan = { scenario: "Checkout", version: 4, environment: "staging", target: "tickets-staging", preset: "peak" } as const;

describe("HTML report", () => {
  it("covers the reporting checklist and stays self-contained", () => {
    const d = buildRunDetail(completedRun(plan), NOW);
    const html = renderReport(d, [], null, NOW);
    for (const part of ["Scenario", "Target and environment", "Approvals", "p50 latency", "p95 latency", "p99 latency", "Error rate", "Recommended next test", d.manifestHash, d.verdict!.result.toUpperCase()]) {
      expect(html).toContain(part);
    }
    expect(html).toContain("@page { size: A4");
    expect(html).not.toMatch(/<link\b|<script\b[^>]*src=|src="https?:|url\(https?:/);
  });

  it("shows journey steps in the journey's own order, with drop-off", () => {
    const journey = {
      steps: [
        { step: "Payment", reached: 66, completed: 51, p95Ms: 2512 },
        { step: "Select ticket", reached: 66, completed: 66, p95Ms: 30 },
      ],
      paymentToConfirmationP95Ms: 6200,
      counts: { order: 51, seat: 51, ticket: 50, charge: 51 },
    };
    const run = completedRun(plan, { journey });
    run.catalog = { ...run.catalog, journeys: run.catalog.journeys.map((j) => (j.id === "checkout" ? { ...j, steps: ["Select ticket", "Payment"] } : j)) };
    const d = buildRunDetail(run, NOW);
    expect(d.results!.journey!.steps.map((s) => s.step)).toEqual(["Select ticket", "Payment"]);
    const html = renderReport(d, [], null, NOW);
    expect(html).toContain("<td>Payment</td><td>66</td><td>51</td><td>15</td><td>2,512 ms</td>");
    expect(html).toContain('<span class="bad">6.20 s</span>');
    expect(html).toContain("51 orders, 51 seats, 50 tickets and 51 charges");
  });

  it("says why a run failed on integrity alone", () => {
    const run = completedRun(plan, { oversoldSeats: 0, doubleCharges: 2, chargedNoTicket: 1 });
    run.run = { ...run.run, verdict: { result: "fail", caveats: [] } };
    const d = buildRunDetail(run, NOW);
    expect(renderReport(d, [], null, NOW)).toContain("Integrity broken: 2 double charges, 1 charge without a ticket.");
  });

  it("lists the release trend when there are two releases or more", () => {
    const point = (releaseId: string, runId: string, p95Ms: number) => ({ releaseId, runId, endedAt: "2026-11-01T00:00:00Z", p95Ms, errorRatePct: 0.1, peakRps: 900, verdict: "pass" as const });
    const run = completedRun(plan);
    run.trend = [point("2026.10.1", "RUN-0000", 380), point("2026.11.1", "RUN-0001", 400)];
    const html = renderReport(buildRunDetail(run, NOW), [], null, NOW);
    expect(html).toContain("<h2>Release trend</h2>");
    expect(html).toContain("RUN-0001 (this run)");
    run.trend = run.trend.slice(0, 1);
    expect(renderReport(buildRunDetail(run, NOW), [], null, NOW)).not.toContain("Release trend");
  });

  it("escapes text that came from people", () => {
    const x = completedRun(plan);
    const evil = '<img src=x onerror="alert(1)">';
    const html = renderReport(buildRunDetail({ ...x, run: { ...x.run, releaseId: evil } }, NOW), [], null, NOW);
    expect(html).not.toContain(evil);
    expect(html).toContain("&lt;img src=x");
  });

  it("recommends a next step that follows from the result", () => {
    const x = completedRun(plan);
    expect(recommendNext(buildRunDetail(x, NOW))).toMatch(/^Run Spike next/);
    const slow = completedRun(plan, { p95Ms: 2_000 });
    expect(recommendNext(buildRunDetail(slow, NOW))).toMatch(/fix it/);
    const broken = completedRun(plan, { oversoldSeats: 0, doubleCharges: 2, chargedNoTicket: 0 });
    expect(recommendNext(buildRunDetail(broken, NOW))).toMatch(/^Find where the 2 double charges came from/);
  });

  it("tells a source that didn't answer apart from no source", () => {
    const x = completedRun(plan);
    expect(renderReport(buildRunDetail(x, NOW), [], null, NOW)).toContain("this target has no read-only data source yet");
    x.timeline = [{ at: NOW.toISOString(), label: "Integrity not verified", note: "HTTP 503", tone: "warning" }];
    const d = buildRunDetail(x, NOW);
    expect(renderReport(d, [], null, NOW)).toContain("the target's read-only source didn't answer");
    expect(recommendNext(d)).toMatch(/why the integrity source didn't answer/);
  });
});
