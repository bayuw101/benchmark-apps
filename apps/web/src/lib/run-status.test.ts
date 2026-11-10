import { describe, expect, it } from "vitest";
import { RUN_STATUSES, RUN_STATUS_META } from "./run-status";

describe("run status", () => {
  it("has exactly the 11 PRD statuses, each with label and tone", () => {
    expect(RUN_STATUSES).toHaveLength(11);
    for (const s of RUN_STATUSES) {
      expect(RUN_STATUS_META[s].label).toBeTruthy();
      expect(RUN_STATUS_META[s].tone).toBeTruthy();
    }
  });
  it("marks only the in-flight statuses as live", () => {
    const live = RUN_STATUSES.filter((s) => RUN_STATUS_META[s].live);
    expect(live).toEqual(["starting", "running", "stopping"]);
  });
  it("uses danger for every terminal failure", () => {
    for (const s of ["failed", "aborted", "rejected"] as const) expect(RUN_STATUS_META[s].tone).toBe("danger");
  });
});
