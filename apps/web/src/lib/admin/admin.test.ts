import { describe, expect, it } from "vitest";
import { roleChangeProblem, validateTarget } from "./validate";

const target = { id: "new-api-staging", environment: "staging", hosts: "api.new.example.com", paths: "/v1\n/health", methods: ["GET", "POST"], peakVus: "500", peakRps: "400", healthPath: "/health" };
const rules = (input: Record<string, unknown>, taken: string[] = [], editing?: string) => validateTarget(input, taken, editing).violations.map((v) => `${v.field}:${v.rule}`);

describe("admin", () => {
  it("validates a target's allowlist, peak and id", () => {
    expect(rules(target)).toEqual([]);
    expect(rules({})).toEqual(["id:required", "environment:required", "hosts:required", "methods:required", "peakVus:range", "peakRps:range"]);
    expect(rules({ ...target, hosts: "*.example.com", paths: "v1" })).toEqual(["hosts:format", "paths:format"]);
    expect(rules(target, ["new-api-staging"])).toEqual(["id:taken"]);
    // The id is fixed after create: an edit keeps it whatever the form sends.
    expect(validateTarget({ ...target, id: "renamed" }, ["new-api-staging"], "new-api-staging").value?.id).toBe("new-api-staging");
    expect(validateTarget(target, []).value?.integrityPath).toBeNull();
    expect(validateTarget({ ...target, integrityPath: " /__admin/integrity " }, []).value?.integrityPath).toBe("/__admin/integrity");
    expect(rules({ ...target, integrityPath: "https://elsewhere.example.com/i" })).toEqual(["integrityPath:format"]);
    // Dot segments would resolve out of the API server's service proxy path.
    for (const integrityPath of ["/../../secrets", "/a/./b", "/a/..", "/a/..?x=1"]) expect(rules({ ...target, integrityPath })).toEqual(["integrityPath:format"]);
    expect(rules({ ...target, integrityPath: "/.well-known/a..b" })).toEqual([]);
  });

  it("allows a port on target hosts but not on redirects", () => {
    expect(rules({ ...target, hosts: "mock-target.targets.svc.cluster.local:3000" })).toEqual([]);
    expect(rules({ ...target, hosts: "api.example.com:0" })).toEqual(["hosts:format"]);
    expect(rules({ ...target, hosts: "api.example.com:65536" })).toEqual(["hosts:format"]);
    expect(rules({ ...target, hosts: "api.example.com:80:81" })).toEqual(["hosts:format"]);
    expect(rules({ ...target, redirects: "login.example.com:443" })).toEqual(["redirects:format"]);
  });

  it("never locks people out", () => {
    expect(roleChangeProblem("bayu", "viewer", "bayu", ["bayu"])).toMatch(/own role/);
    expect(roleChangeProblem("other", "viewer", "bayu", ["other"])).toMatch(/last admin/);
    expect(roleChangeProblem("other", "viewer", "bayu", ["other", "bayu"])).toBeNull();
  });
});
