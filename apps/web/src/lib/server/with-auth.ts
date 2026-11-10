import "server-only";
import { leaseSecret } from "@btb/core/env";
import { leaseTokenValid, signatureValid } from "@btb/core/lease";
import { RUNNER_SIGNATURE_HEADER } from "@btb/contracts";
import { RUN_ID_RE, violationsOf, type ZodType } from "@btb/contracts/schemas";
import { NextResponse, type NextRequest } from "next/server";

import { getSession } from "@/lib/auth/session";
import { atLeast, type Role, type SessionUser } from "@/lib/session";

/*
 * Every handler in app/api/** is wrapped by one of these (PRD E1.2; with-auth.test.ts fails on an unwrapped
 * one). The role is checked here, in the handler, not only in middleware or by a hidden nav item. A handler that
 * takes a body names its zod schema (`@btb/contracts/schemas`, the one the form uses too); it gets the parsed body,
 * and anything else answers 400 with the problems as violations.
 */

type Params = Record<string, string>;
type RouteContext<P extends Params> = { params: Promise<P> };

const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status });
/** Form bodies are a few hundred bytes; the largest (a target's allowlist) stays far below this. */
const BODY_MAX_BYTES = 64 * 1024;

function parseBody<B>(schema: ZodType<B>, text: string): { body: B } | Response {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json(400, { error: "bad request", violations: [{ field: "", rule: "schema", message: "The body isn't JSON." }] });
  }
  const r = schema.safeParse(raw);
  return r.success ? { body: r.data } : json(400, { error: "bad request", violations: violationsOf(r.error) });
}

/**
 * Signed-in users with at least `role`. 401 without a session, 403 below the role (with `forbidden` as the reason).
 * With `schema`, the JSON body is parsed after the role check. Routes with params and a body name both types:
 * `withAuth<{ id: string }, PoolInput>`.
 */
export function withAuth<P extends Params = Params, B = undefined>(
  handler: (request: NextRequest, auth: { user: SessionUser; params: P; body: B }) => Promise<Response>,
  opts: { role: Role; forbidden?: string; schema?: ZodType<B> },
) {
  return async (request: NextRequest, ctx: RouteContext<P>): Promise<Response> => {
    const user = await getSession();
    if (!user) return json(401, { error: "unauthenticated" });
    if (!atLeast(user.role, opts.role)) return json(403, { error: "forbidden", ...(opts.forbidden ? { reason: opts.forbidden } : {}) });
    let body = undefined as B;
    if (opts.schema) {
      if (Number(request.headers.get("content-length") ?? 0) > BODY_MAX_BYTES) return json(413, { error: "body too large" });
      const text = await request.text();
      if (Buffer.byteLength(text) > BODY_MAX_BYTES) return json(413, { error: "body too large" });
      const parsed = parseBody(opts.schema, text);
      if (parsed instanceof Response) return parsed;
      body = parsed.body;
    }
    return handler(request, { user, params: await ctx.params, body });
  };
}

/** Lease and plain runner bodies are a few dozen bytes; signed callbacks pass their own limit. */
const RUNNER_BODY_MAX_BYTES = 4096;

export interface RunnerAuth<B = null> {
  runId: string;
  /** The raw body for `runIdIn: "body"` (already size-checked, and signature-checked when `signed`); null for "query". */
  text: string | null;
  /** The body parsed with `schema`; null without one. */
  body: B;
}

/**
 * Runner pods: no user session. The caller proves itself with the run's lease token (Bearer), for the run id in
 * the query (`?runId=`) or in the JSON body (`{ runId }`). `signed` also requires the body's HMAC with that token
 * in x-btb-signature, and a Content-Length so oversized bodies are refused before they are read. `schema` parses
 * the body once the caller is proven (400 when it doesn't fit).
 */
export function withRunnerAuth<B = null>(
  handler: (request: NextRequest, runner: RunnerAuth<B>) => Promise<Response>,
  opts: { runIdIn: "query" | "body"; signed?: { maxBytes: number }; schema?: ZodType<B> },
) {
  return async (request: NextRequest): Promise<Response> => {
    const token = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
    let runId = "";
    let text: string | null = null;

    if (opts.runIdIn === "query") {
      runId = request.nextUrl.searchParams.get("runId") ?? "";
    } else {
      const max = opts.signed?.maxBytes ?? RUNNER_BODY_MAX_BYTES;
      const declared = request.headers.get("content-length");
      if (opts.signed && (declared === null || !Number.isInteger(Number(declared)))) return json(411, { error: "content-length required" });
      if (declared !== null && Number(declared) > max) return json(413, { error: "body too large" });
      text = await request.text();
      if (Buffer.byteLength(text) > max) return json(413, { error: "body too large" });
      try {
        const id = (JSON.parse(text) as { runId?: unknown } | null)?.runId;
        runId = typeof id === "string" ? id : "";
      } catch {
        runId = "";
      }
    }

    if (!RUN_ID_RE.test(runId) || !leaseTokenValid(leaseSecret(), runId, token)) return json(401, { error: "unauthorized" });
    if (opts.signed && !signatureValid(token, text ?? "", request.headers.get(RUNNER_SIGNATURE_HEADER) ?? "")) return json(401, { error: "bad signature" });
    let body = null as B;
    if (opts.schema) {
      const parsed = parseBody(opts.schema, text ?? "");
      if (parsed instanceof Response) return parsed;
      body = parsed.body;
    }
    return handler(request, { runId, text, body });
  };
}
