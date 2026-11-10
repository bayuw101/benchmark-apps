import { z } from "zod";

import { RUNNER_EVENTS, type PolicyViolation, type RunManifest, type RunnerCallback } from "./index";

/*
 * zod schemas for what crosses a trust boundary (PRD E1.2, E3.2): request bodies, the run manifest and runner
 * callbacks. The forms parse with the same schema before submit, the API routes before the handler runs.
 *
 * Schemas check shape only (types, lengths, closed sets). Rules that need data or give per-field advice (allowlist,
 * ceilings, taken names, "Choose a …") stay in the policy and validators and answer 422.
 *
 * A separate entry (`@btb/contracts/schemas`) so the runner's k6 bundle, which imports the index, doesn't pull zod.
 */

export type { ZodType } from "zod";

const text = (max: number) => z.string().max(max, `Use at most ${max} characters.`);
/** Form inputs send numbers as typed text; API callers may send numbers. The validators turn both into numbers. */
const numeric = z.union([z.number(), z.string().max(20, "Enter a number.")]);
const list = (itemMax: number) => z.union([text(itemMax * 50), z.array(text(itemMax)).max(50, "Use at most 50 entries.")]);

export const RUN_ID_RE = /^RUN-\d+$/;

/** A schema failure as violations, so forms show it on the field like the policy's 422. */
export function violationsOf(error: z.ZodError): PolicyViolation[] {
  return error.issues.map((i) => ({ field: i.path.map(String).join("."), rule: "schema", message: i.message }));
}

export function parseWith<T>(schema: z.ZodType<T>, value: unknown): { ok: true; data: T } | { ok: false; violations: PolicyViolation[] } {
  const r = schema.safeParse(value);
  return r.success ? { ok: true, data: r.data } : { ok: false, violations: violationsOf(r.error) };
}

/* ---------- Runs (E3.1–E3.3) ---------- */

/** Create run / Edit: every field optional, so a missing one becomes a policy violation on its field. */
export const runPlanInputSchema = z.object({
  scenario: text(100).optional(),
  version: z.number().int().positive().optional(),
  environment: text(100).optional(),
  target: text(100).optional(),
  preset: text(100).optional(),
  network: text(100).optional(),
  releaseId: text(100).optional(),
});
export type RunPlanInput = z.infer<typeof runPlanInputSchema>;

/** The immutable plan approvals are bound to (E3.2). Strict: nothing outside the contract gets hashed or run. */
export const runManifestSchema: z.ZodType<RunManifest> = z.strictObject({
  projectId: z.string().min(1),
  scenario: z.strictObject({ name: z.string().min(1), journey: z.string().min(1), version: z.number().int().positive(), imageVersion: z.string().min(1) }),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  environment: z.enum(["staging", "prod-like"]),
  target: z.string().min(1),
  preset: z.enum(["smoke", "baseline", "peak", "spike", "soak", "stress"]),
  load: z.strictObject({ model: z.enum(["vus", "rps"]), target: z.number().int().positive(), durationSec: z.number().int().positive(), rampSec: z.number().int().nonnegative() }),
  network: z.enum(["stadium-4g", "wifi-baseline"]).nullable(),
  thresholds: z.strictObject({ p95Ms: z.number().positive(), errorRatePct: z.number().min(0).max(100), abortOnFail: z.literal(true) }).nullable(),
  releaseId: z.string().min(1).nullable(),
});

export const rejectInputSchema = z.object({ note: text(1000).optional() });
export type RejectInput = z.infer<typeof rejectInputSchema>;

/* ---------- Scenarios (E2.3) ---------- */

export const scenarioInputSchema = z.object({
  scenario: text(40).optional(),
  name: text(80).optional(),
  journey: text(40).optional(),
  model: text(10).optional(),
  params: z.record(text(100), z.union([z.string().max(1000, "Use at most 1000 characters."), z.number(), z.boolean()])).optional(),
  p95Ms: numeric.optional(),
  errorRatePct: numeric.optional(),
  note: text(400).optional(),
});
export type ScenarioInput = z.infer<typeof scenarioInputSchema>;

/* ---------- Admin (UI-07) ---------- */

export const projectInputSchema = z.object({ name: text(100).optional(), description: text(400).optional() });
export type ProjectInput = z.infer<typeof projectInputSchema>;

export const targetInputSchema = z.object({
  id: text(100).optional(),
  environment: text(20).optional(),
  hosts: list(260).optional(),
  paths: list(200).optional(),
  methods: z.array(text(10)).max(10).optional(),
  redirects: list(260).optional(),
  peakVus: numeric.optional(),
  peakRps: numeric.optional(),
  healthPath: text(200).optional(),
  integrityPath: text(200).optional(),
});
export type TargetInput = z.infer<typeof targetInputSchema>;

export const ceilingInputSchema = z.object({
  vus: numeric.optional(),
  rps: numeric.optional(),
  durationMin: numeric.optional(),
  rampPerMin: numeric.optional(),
});
export type CeilingInput = z.infer<typeof ceilingInputSchema>;

export const personInputSchema = z.object({ name: text(100).optional(), email: text(254).optional(), role: text(20).optional() });

/** "none" removes access. */
export const roleChangeSchema = z.object({ role: z.enum(["viewer", "engineer", "approver", "admin", "none"]) });
export type RoleChange = z.infer<typeof roleChangeSchema>;

export const poolInputSchema = z.object({
  total: numeric.optional(),
  secretPath: text(200).optional(),
  seedMethod: text(10).optional(),
  seedPath: text(200).optional(),
  cleanupMethod: text(10).optional(),
  cleanupPath: text(200).optional(),
});
export type PoolInput = z.infer<typeof poolInputSchema>;

/* ---------- Runner pods (E5.3, E6.1, E6.6) ---------- */

export const leaseRequestSchema = z.object({ runId: z.string().regex(RUN_ID_RE) });

export const runnerCallbackSchema: z.ZodType<RunnerCallback> = z.object({
  runId: z.string().regex(RUN_ID_RE),
  pod: z.string().regex(/^[a-z0-9-]{1,63}$/),
  event: z.enum(RUNNER_EVENTS),
  reason: z.string().max(300).optional(),
  thresholdsOk: z.boolean().optional(),
  iterations: z.number().int().nonnegative().optional(),
});
