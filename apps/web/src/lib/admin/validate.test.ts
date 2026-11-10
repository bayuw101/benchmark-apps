import { describe, expect, it } from "vitest";

import { validatePool } from "./validate";

const HOST = "mock-target.targets.svc.cluster.local:3000";

describe("validatePool", () => {
  it("builds HTTP hooks on the target's own host", () => {
    const { value } = validatePool({ total: "50", secretPath: "local/mock/ids", seedMethod: "POST", seedPath: "/__admin/reset", cleanupPath: "" }, HOST);
    expect(value).toEqual({
      total: 50,
      secretPath: "local/mock/ids",
      seedHook: { kind: "http", name: "POST /__admin/reset", method: "POST", url: `http://${HOST}/__admin/reset` },
      cleanupHook: null,
    });
  });

  it("refuses paths that don't start with /, and unknown methods", () => {
    const { violations } = validatePool({ total: 1, secretPath: "a/b", seedMethod: "GET", seedPath: "evil.com/x", cleanupMethod: "POST", cleanupPath: "@evil.com" }, HOST);
    expect(violations.map((v) => v.field).sort()).toEqual(["cleanupPath", "seedMethod", "seedPath"]);
  });

  it("checks the pool size and secret path", () => {
    const { violations } = validatePool({ total: "-1", secretPath: "../x y" }, HOST);
    expect(violations.map((v) => v.field)).toEqual(["total", "secretPath"]);
  });
});
