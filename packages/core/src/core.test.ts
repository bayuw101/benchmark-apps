import { describe, expect, it } from "vitest";

import { APPROVAL_VALIDITY_MS, approvalsSatisfied, validApprovals, type ApprovalFacts } from "./approvals";
import { isLocalHost } from "./executor";
import { INTEGRITY_PATH_RE, integrityClean, integrityCountsOf, integrityRequestPath } from "./integrity";
import { leaseToken, leaseTokenValid, signatureValid, signBody } from "./lease";
import { canonicalJson, hashManifest } from "./manifest";

describe("lease token", () => {
  const exp = 2_000_000_000;
  const before = (exp - 60) * 1000;

  it("only fits its own run and secret", () => {
    const t = leaseToken("s", "RUN-1", exp);
    expect(leaseTokenValid("s", "RUN-1", t, before)).toBe(true);
    expect(leaseTokenValid("s", "RUN-2", t, before)).toBe(false);
    expect(leaseTokenValid("x", "RUN-1", t, before)).toBe(false);
    expect(leaseTokenValid("s", "RUN-1", "short", before)).toBe(false);
  });

  it("expires, and the expiry can't be pushed out", () => {
    const t = leaseToken("s", "RUN-1", exp);
    expect(leaseTokenValid("s", "RUN-1", t, exp * 1000)).toBe(false);
    expect(leaseTokenValid("s", "RUN-1", t.replace(String(exp), String(exp + 3600)), before)).toBe(false);
  });

  it("signs callback bodies", () => {
    const t = leaseToken("s", "RUN-1", exp);
    const sig = signBody(t, '{"event":"finished"}');
    expect(signatureValid(t, '{"event":"finished"}', sig)).toBe(true);
    expect(signatureValid(t, '{"event":"verified"}', sig)).toBe(false);
    expect(signatureValid(leaseToken("s", "RUN-2", exp), '{"event":"finished"}', sig)).toBe(false);
  });
});

const now = new Date("2026-11-08T12:00:00Z");
const later = new Date(now.getTime() + APPROVAL_VALIDITY_MS);
const earlier = new Date(now.getTime() - 1000);
const HASH = "a".repeat(64);
const ok = (userId: string | null, over: Partial<ApprovalFacts> = {}): ApprovalFacts => ({ userId, manifestHash: HASH, decision: "approved", expiresAt: later, ...over });
const run = (environment: "staging" | "prod-like", preset: "peak" | "spike") => ({ environment, preset, manifestHash: HASH, createdById: "creator" });

describe("manifest hash", () => {
  it("is the same whatever the key order or whitespace (jsonb round trip)", () => {
    const a = { projectId: "p", load: { target: 5, model: "vus" }, network: null, list: [2, 1] };
    const reordered = JSON.parse('{"list": [2, 1], "load": {"model": "vus", "target": 5}, "network": null, "projectId": "p"}');
    expect(hashManifest(reordered)).toBe(hashManifest(a));
    expect(canonicalJson(a)).toBe('{"list":[2,1],"load":{"model":"vus","target":5},"network":null,"projectId":"p"}');
  });

  it("changes with any value", () => {
    expect(hashManifest({ load: 5 })).not.toBe(hashManifest({ load: 6 }));
  });
});

describe("approvals", () => {
  it("count only for the current hash and until they expire", () => {
    const rows = [ok("u1"), ok("u2", { manifestHash: "b".repeat(64) }), ok("u3", { expiresAt: earlier }), ok("u4", { decision: "rejected" })];
    expect(validApprovals(rows, HASH, now).map((a) => a.userId)).toEqual(["u1"]);
  });

  it("auto-approved runs need the policy row", () => {
    expect(approvalsSatisfied({ ...run("staging", "peak") }, [], now)).toBe(false);
    expect(approvalsSatisfied({ ...run("staging", "peak") }, [ok(null)], now)).toBe(true);
  });

  it("prod-like needs two different people, never the creator", () => {
    const prod = run("prod-like", "peak");
    expect(approvalsSatisfied(prod, [ok("u1")], now)).toBe(false);
    expect(approvalsSatisfied(prod, [ok("u1"), ok("u1")], now)).toBe(false);
    expect(approvalsSatisfied(prod, [ok("u1"), ok("creator")], now)).toBe(false);
    expect(approvalsSatisfied(prod, [ok("u1"), ok("u2")], now)).toBe(true);
  });

  it("an edit voids earlier approvals; expiry only counts when asked", () => {
    const spike = run("staging", "spike");
    expect(approvalsSatisfied(spike, [ok("u1", { manifestHash: "b".repeat(64) })])).toBe(false);
    expect(approvalsSatisfied(spike, [ok("u1", { expiresAt: earlier })], now)).toBe(false);
    expect(approvalsSatisfied(spike, [ok("u1", { expiresAt: earlier })])).toBe(true);
  });
});

describe("integrity adapter", () => {
  it("reads whole, non-negative counts and nothing else", () => {
    expect(integrityCountsOf({ oversold: 0, doubleCharges: 2, chargedNoTicket: 1, orders: 9 })).toEqual({ oversoldSeats: 0, doubleCharges: 2, chargedNoTicket: 1 });
    expect(() => integrityCountsOf({ oversold: 0, doubleCharges: -1, chargedNoTicket: 0 })).toThrow(/doubleCharges/);
    expect(() => integrityCountsOf({ oversold: "0", doubleCharges: 0, chargedNoTicket: 0 })).toThrow(/oversold/);
    expect(() => integrityCountsOf(null)).toThrow();
    expect(integrityClean({ oversoldSeats: 0, doubleCharges: 0, chargedNoTicket: 0 })).toBe(true);
  });

  it("adds the run window to the path", () => {
    const w = { from: new Date(1000), to: new Date(2000) };
    expect(integrityRequestPath("/__admin/integrity", w)).toBe("/__admin/integrity?since=1000&until=2000");
    expect(integrityRequestPath("/i?db=tickets", w)).toBe("/i?db=tickets&since=1000&until=2000");
  });

  it("only accepts a plain path for the admin setting", () => {
    expect(INTEGRITY_PATH_RE.test("/__admin/integrity")).toBe(true);
    for (const bad of ["http://evil/x", "//evil/x", "admin", "/a b", "/x#y"]) expect(INTEGRITY_PATH_RE.test(bad)).toBe(false);
  });
});

describe("docker executor host rule", () => {
  it("allows loopback only", () => {
    for (const ok of ["localhost:8081", "127.0.0.1:8081", "127.1.2.3", "[::1]:3000", "mock.localhost:80"]) expect(isLocalHost(ok)).toBe(true);
    for (const bad of ["mock-target.targets.svc.cluster.local:3000", "tickets.staging.example.com", "10.0.0.5:80", "host.docker.internal:8081", "localhost.example.com", "127.0.0.1.nip.io"]) expect(isLocalHost(bad)).toBe(false);
  });
});
