import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { leaseToken, signBody } from "@btb/core/lease";
import { leaseRequestSchema, rejectInputSchema, type RejectInput } from "@btb/contracts/schemas";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionUser } from "@/lib/session";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => session.user }));

const { withAuth, withRunnerAuth } = await import("./with-auth");

const APP = path.join(__dirname, "../../app");
const METHODS = "GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS";

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? routeFiles(p) : e.name === "route.ts" ? [p] : [];
  });
}

describe("every route handler is wrapped (PRD E1.2)", () => {
  const files = routeFiles(APP);

  it("finds the route files", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files.map((f) => [path.relative(APP, f), f]))("%s", (_name, file) => {
    const src = readFileSync(file, "utf8");
    // No plain handler exports and no re-exports that could hide one.
    expect(src).not.toMatch(new RegExp(`export\\s+(async\\s+)?function\\s+(${METHODS})\\b`));
    expect(src).not.toMatch(new RegExp(`export\\s*\\{[^}]*\\b(${METHODS})\\b`));
    const handlers = [...src.matchAll(new RegExp(`export\\s+const\\s+(${METHODS})\\s*=\\s*([\\w.]+)`, "g"))];
    expect(handlers.length).toBeGreaterThan(0);
    for (const [, method, callee] of handlers) expect([method, callee]).toEqual([method, expect.stringMatching(/^(withAuth|withRunnerAuth)$/)]);
    // JSON bodies come parsed through the wrapper's zod `schema`, never read by hand (raw uploads are bytes).
    expect(src).not.toMatch(/\.(json|text|formData)\(\)/);
  });
});

const user = (role: SessionUser["role"]): SessionUser => ({ id: "u1", name: "Test", email: "t@example.com", role });
const ctx = { params: Promise.resolve({ id: "RUN-1" }) };
const req = (url = "http://localhost/api/x", init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(url, init);

describe("withAuth", () => {
  const handler = withAuth<{ id: string }>(async (_r, { user, params }) => Response.json({ who: user.id, id: params.id }), { role: "engineer", forbidden: "Engineers only." });
  beforeEach(() => (session.user = null));

  it("refuses without a session and below the role, before the handler runs", async () => {
    expect((await handler(req(), ctx)).status).toBe(401);
    session.user = user("viewer");
    const res = await handler(req(), ctx);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden", reason: "Engineers only." });
  });

  it("passes the user and params at or above the role", async () => {
    session.user = user("admin");
    expect(await (await handler(req(), ctx)).json()).toEqual({ who: "u1", id: "RUN-1" });
  });

  it("parses the body with the schema after the role check, 400 with violations otherwise", async () => {
    const seen: RejectInput[] = [];
    const h = withAuth<{ id: string }, RejectInput>(async (_r, { body }) => (seen.push(body), Response.json(body)), { role: "approver", schema: rejectInputSchema });
    const post = (body: string) => h(req("http://localhost/api/x", { method: "POST", body }), ctx);

    expect((await post("{}")).status).toBe(401);
    session.user = user("approver");
    expect(await (await post(JSON.stringify({ note: "too risky", extra: 1 }))).json()).toEqual({ note: "too risky" });
    const bad = await post(JSON.stringify({ note: 42 }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).violations).toEqual([expect.objectContaining({ field: "note", rule: "schema" })]);
    expect((await post("not json")).status).toBe(400);
    expect((await post(JSON.stringify({ note: "x".repeat(70_000) }))).status).toBe(413);
    expect(seen).toHaveLength(1);
  });
});

describe("withRunnerAuth", () => {
  const secret = "btb-dev-only-lease-secret";
  vi.stubEnv("LEASE_SECRET", "");
  const token = leaseToken(secret, "RUN-7", Math.floor(Date.now() / 1000) + 600);
  const echo = (r: { runId: string; text: string | null }) => Response.json(r);

  it("checks the lease token for the run id in the query", async () => {
    const h = withRunnerAuth(async (_r, a) => echo(a), { runIdIn: "query" });
    expect((await h(req("http://localhost/api/runner/x?runId=RUN-7", { headers: { authorization: `Bearer ${token}` } }))).status).toBe(200);
    expect((await h(req("http://localhost/api/runner/x?runId=RUN-8", { headers: { authorization: `Bearer ${token}` } }))).status).toBe(401);
    expect((await h(req("http://localhost/api/runner/x?runId=RUN-7"))).status).toBe(401);
  });

  it("requires length and signature for signed bodies", async () => {
    const h = withRunnerAuth(async (_r, a) => echo(a), { runIdIn: "body", signed: { maxBytes: 64 } });
    const body = JSON.stringify({ runId: "RUN-7" });
    const post = (headers: Record<string, string>, b = body) => h(req("http://localhost/api/runner/cb", { method: "POST", body: b, headers: { authorization: `Bearer ${token}`, ...headers } }));
    expect((await post({ "content-length": String(body.length), "x-btb-signature": signBody(token, body) })).status).toBe(200);
    expect((await post({ "content-length": String(body.length), "x-btb-signature": "nope" })).status).toBe(401);
    expect((await post({ "content-length": "999", "x-btb-signature": signBody(token, body) })).status).toBe(413);
  });

  it("parses the body with the schema once the caller is proven", async () => {
    const h = withRunnerAuth(async (_r, { body }) => Response.json(body), { runIdIn: "body", schema: leaseRequestSchema.extend({ n: leaseRequestSchema.shape.runId.optional() }) });
    const post = (b: unknown, t = token) => h(req("http://localhost/api/runner/lease", { method: "POST", body: JSON.stringify(b), headers: { authorization: `Bearer ${t}` } }));
    expect(await (await post({ runId: "RUN-7" })).json()).toEqual({ runId: "RUN-7" });
    expect((await post({ runId: "RUN-7", n: 5 })).status).toBe(400);
    expect((await post({ runId: "RUN-7", n: 5 }, "wrong")).status).toBe(401);
  });
});
