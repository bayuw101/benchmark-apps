import { describe, expect, it } from "vitest";
import { buildRunDetail, grafanaRunUrl } from "./detail";
import { completedRun } from "./test-catalog";

describe("versions (E0.1)", () => {
  it("shows web and worker from the run row and the runner image from the manifest", () => {
    const x = completedRun({ scenario: "Checkout", version: 4, environment: "staging", target: "tickets-staging", preset: "smoke" });
    const d = buildRunDetail(x, new Date("2026-11-07T10:00:00Z"));
    expect(d.versions).toEqual({ web: "1a2b3c4d5e6f", worker: "1a2b3c4d5e6f", runner: x.run.manifest.scenario.imageVersion });
  });
});

describe("grafanaRunUrl", () => {
  const run = { id: "RUN-0182", startedAt: "2026-11-08T13:10:00.000Z", endedAt: "2026-11-08T13:25:00.000Z" };

  it("opens the k6 run dashboard on this run, a minute either side", () => {
    expect(grafanaRunUrl("http://localhost:3300/", run)).toBe(
      `http://localhost:3300/d/btb-k6-run/k6-run?var-testid=RUN-0182&from=${Date.parse(run.startedAt) - 60_000}&to=${Date.parse(run.endedAt) + 60_000}`,
    );
    expect(grafanaRunUrl("https://grafana.example", { ...run, endedAt: undefined })).toMatch(/&to=now$/);
  });

  it("is null without Grafana, for an unstarted run, or for a non-http base", () => {
    expect(grafanaRunUrl(undefined, run)).toBeNull();
    expect(grafanaRunUrl("http://localhost:3300", { ...run, startedAt: undefined })).toBeNull();
    expect(grafanaRunUrl("javascript:alert(1)//", run)).toBeNull();
  });
});
