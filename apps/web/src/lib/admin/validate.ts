import { targetUrl } from "@btb/contracts";

import { HTTP_METHODS, type HttpMethod, type Target } from "@/lib/runs/catalog";
import type { Ceiling } from "@/lib/runs/environments";
import type { PolicyViolation } from "@/lib/runs/types";
import type { Role } from "@/lib/session";
import { INTEGRITY_PATH_RE } from "@btb/core/integrity";

/*
 * Admin form rules (UI-07). Pure: the API decides, and the tests cover the edges. Each problem names its
 * form field, like the run policy.
 */

type Result<T> = { violations: PolicyViolation[]; value: T | null };
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const lines = (v: unknown) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\n,]/) : []).map((x) => String(x).trim()).filter(Boolean);
const int = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(/,/g, "")) : NaN);

const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
/** A target host may name a port (in-cluster services listen on e.g. :3000). Redirect hosts may not. */
const hostWithPort = (h: string) => {
  const [name, port, ...rest] = h.split(":");
  return !rest.length && HOST_RE.test(name) && (port === undefined || (/^\d{1,5}$/.test(port) && Number(port) >= 1 && Number(port) <= 65_535));
};
const PATH_RE = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/;
const ID_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const ROLES: Role[] = ["viewer", "engineer", "approver", "admin"];

export function validateProject(input: { name?: unknown; description?: unknown }, takenNames: string[]): Result<{ name: string; description?: string }> {
  const v: PolicyViolation[] = [];
  const name = str(input.name);
  const description = str(input.description) || undefined;
  if (!name) v.push({ field: "name", rule: "required", message: "Name the project." });
  else if (name.length < 2 || name.length > 40) v.push({ field: "name", rule: "length", message: "Use 2–40 characters." });
  else if (takenNames.some((n) => n.toLowerCase() === name.toLowerCase())) v.push({ field: "name", rule: "taken", message: "Another project already has this name." });
  if (description && description.length > 80) v.push({ field: "description", rule: "length", message: "Keep it under 80 characters." });
  return { violations: v, value: v.length ? null : { name, description } };
}

export function validateTarget(input: Record<string, unknown>, takenIds: string[], editingId?: string): Result<Target> {
  const v: PolicyViolation[] = [];
  const add = (field: string, rule: string, message: string) => v.push({ field, rule, message });

  // The id is what runs and manifests refer to, so it can't change after create.
  const id = editingId ?? str(input.id).toLowerCase();
  if (!editingId) {
    if (!id) add("id", "required", "Name the target.");
    else if (!ID_RE.test(id)) add("id", "format", "Use 3–40 lowercase letters, digits and dashes, e.g. tickets-staging.");
    else if (takenIds.includes(id)) add("id", "taken", "This project already has a target with this name.");
  }
  const environment = input.environment === "staging" || input.environment === "prod-like" ? input.environment : null;
  if (!environment) add("environment", "required", "Choose an environment.");

  const hosts = lines(input.hosts).map((h) => h.toLowerCase());
  if (!hosts.length) add("hosts", "required", "Add at least one hostname.");
  const badHost = hosts.find((h) => !hostWithPort(h));
  if (badHost) add("hosts", "format", `"${badHost}" isn't a hostname. Use exact names like api.example.com (optionally with :port), no wildcards or paths.`);

  const paths = lines(input.paths);
  const badPath = paths.find((x) => !PATH_RE.test(x));
  if (badPath) add("paths", "format", `"${badPath}" must start with / and contain no spaces.`);

  const methods = (Array.isArray(input.methods) ? input.methods : []).filter((m): m is HttpMethod => HTTP_METHODS.includes(m as HttpMethod));
  if (!methods.length) add("methods", "required", "Allow at least one method.");

  const redirects = lines(input.redirects).map((h) => h.toLowerCase());
  const badRedirect = redirects.find((h) => !HOST_RE.test(h));
  if (badRedirect) add("redirects", "format", `"${badRedirect}" isn't a hostname.`);

  const vus = int(input.peakVus);
  if (!Number.isInteger(vus) || vus < 1 || vus > 1_000_000) add("peakVus", "range", "Use a whole number from 1 to 1,000,000.");
  const rps = int(input.peakRps);
  if (!Number.isInteger(rps) || rps < 1 || rps > 1_000_000) add("peakRps", "range", "Use a whole number from 1 to 1,000,000.");

  const healthPath = str(input.healthPath) || "/health";
  if (!PATH_RE.test(healthPath)) add("healthPath", "format", "Use a path on the target, starting with /, e.g. /health.");

  const integrityPath = str(input.integrityPath) || null;
  if (integrityPath && !INTEGRITY_PATH_RE.test(integrityPath)) add("integrityPath", "format", "Use a path on the target, starting with /, e.g. /integrity. Leave empty if there's no read-only source.");

  if (v.length || !environment) return { violations: v, value: null };
  return {
    violations: [],
    value: { id, name: id, environment, hosts: [...new Set(hosts)], paths: paths.length ? [...new Set(paths)] : ["/"], methods, redirects: [...new Set(redirects)], referencePeak: { vus, rps }, healthPath, integrityPath },
  };
}

export function validateCeiling(input: Record<string, unknown>): Result<Ceiling> {
  const v: PolicyViolation[] = [];
  const check = (field: string, min: number, max: number) => {
    const n = int(input[field]);
    if (!Number.isInteger(n) || n < min || n > max) v.push({ field, rule: "range", message: `Use a whole number from ${min.toLocaleString("en-US")} to ${max.toLocaleString("en-US")}.` });
    return n;
  };
  const vus = check("vus", 1, 1_000_000);
  const rps = check("rps", 1, 1_000_000);
  const minutes = check("durationMin", 1, 24 * 60);
  const rampPerMin = check("rampPerMin", 1, 1_000_000);
  return { violations: v, value: v.length ? null : { vus, rps, durationSec: minutes * 60, rampPerMin } };
}

export function validatePerson(input: { name?: unknown; email?: unknown; role?: unknown }, takenEmails: string[]): Result<{ name: string; email: string; role: Role | null }> {
  const v: PolicyViolation[] = [];
  const name = str(input.name);
  const email = str(input.email).toLowerCase();
  const role = input.role === "none" ? null : ROLES.includes(input.role as Role) ? (input.role as Role) : undefined;
  if (!name) v.push({ field: "name", rule: "required", message: "Enter their name." });
  if (!EMAIL_RE.test(email)) v.push({ field: "email", rule: "format", message: "Enter their work email (the one they sign in to Microsoft with)." });
  else if (takenEmails.includes(email)) v.push({ field: "email", rule: "taken", message: "This person is already in the list." });
  if (role === undefined) v.push({ field: "role", rule: "required", message: "Choose a role." });
  return { violations: v, value: v.length || role === undefined ? null : { name, email, role } };
}

export const HOOK_METHODS = ["POST", "PUT", "DELETE"] as const;
export type HookMethod = (typeof HOOK_METHODS)[number];
export type HttpHook = { kind: "http"; name: string; method: HookMethod; url: string };
const SECRET_PATH_RE = /^[A-Za-z0-9._/-]{1,200}$/;

/**
 * Test-data pool (E2.6). PROPOSAL (TBD-6): hooks are HTTP calls to a path on the target's first host, so a hook
 * can't reach anything the target allowlist doesn't already name.
 */
export function validatePool(input: Record<string, unknown>, host: string): Result<{ total: number; secretPath: string; seedHook: HttpHook | null; cleanupHook: HttpHook | null }> {
  const v: PolicyViolation[] = [];
  const total = int(input.total);
  if (!Number.isInteger(total) || total < 0 || total > 1_000_000) v.push({ field: "total", rule: "range", message: "Use a whole number from 0 to 1,000,000." });
  const secretPath = str(input.secretPath);
  if (!SECRET_PATH_RE.test(secretPath)) v.push({ field: "secretPath", rule: "format", message: "Use a secret path like team/target/identities: letters, digits, . _ - and /." });
  const hook = (prefix: "seed" | "cleanup"): HttpHook | null => {
    const path = str(input[`${prefix}Path`]);
    if (!path) return null;
    const method = HOOK_METHODS.find((m) => m === input[`${prefix}Method`]);
    if (!method) v.push({ field: `${prefix}Method`, rule: "required", message: "Choose POST, PUT or DELETE." });
    if (!PATH_RE.test(path)) v.push({ field: `${prefix}Path`, rule: "format", message: "Use a path on the target, starting with /, no spaces." });
    return method ? { kind: "http", name: `${method} ${path}`, method, url: `${targetUrl(host)}${path}` } : null;
  };
  const seedHook = hook("seed");
  const cleanupHook = hook("cleanup");
  return { violations: v, value: v.length ? null : { total, secretPath, seedHook, cleanupHook } };
}

/** Role changes that would lock people out: your own role, or the last admin. */
export function roleChangeProblem(targetId: string, nextRole: Role | null, byId: string, admins: string[]): string | null {
  if (targetId === byId) return "You can't change your own role. Ask another admin.";
  if (nextRole !== "admin" && admins.length === 1 && admins[0] === targetId) return "This is the last admin. Make someone else an admin first.";
  return null;
}
