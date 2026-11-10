import "server-only";

import { ACTIVE_STATUSES } from "@btb/contracts";
import { writeAudit } from "@btb/core/audit";
import { and, count, eq, inArray } from "drizzle-orm";

import { isUniqueViolation } from "@btb/core/db";
import { db, schema } from "@/db";
import { projectSlug } from "@/lib/projects";
import { ENVIRONMENTS } from "@/lib/runs/environments";
import type { PolicyViolation } from "@/lib/runs/types";
import { getCatalog } from "@/lib/server/catalog";
import { listProjects } from "@/lib/server/projects";
import { getUser, listPeople } from "@/lib/server/users";
import { ROLE_LABEL, type Role, type SessionUser } from "@/lib/session";
import { roleChangeProblem, validateCeiling, validatePerson, validatePool, validateProject, validateTarget } from "@/lib/admin/validate";

/*
 * Admin changes (UI-07). Each one validates, refuses what would break history or lock people out, and writes
 * an audit_logs row in the same transaction (story 44).
 */

const { environments, projects, runs, scenarios, targets, testDataPools, users } = schema;

export type AdminResult<T = unknown> = { ok: true; value: T } | { ok: false; status: 404 | 409; reason: string } | { ok: false; status: 422; violations: PolicyViolation[] };

const invalid = (violations: PolicyViolation[]): AdminResult<never> => ({ ok: false, status: 422, violations });
const conflict = (reason: string): AdminResult<never> => ({ ok: false, status: 409, reason });
const missing = (what: string): AdminResult<never> => ({ ok: false, status: 404, reason: `${what} doesn't exist.` });
const actor = (u: SessionUser) => ({ id: u.id, name: u.name });

/** Runs the change; a unique-index race (two admins at once) becomes a 409 instead of a 500. */
async function guarded<T>(change: () => Promise<AdminResult<T>>, clash: string): Promise<AdminResult<T>> {
  try {
    return await change();
  } catch (e) {
    if (isUniqueViolation(e)) return conflict(clash);
    throw e;
  }
}

export async function createProject(input: Record<string, unknown>, by: SessionUser): Promise<AdminResult> {
  const all = await listProjects();
  const { violations, value } = validateProject(input, all.map((p) => p.name));
  if (!value) return invalid(violations);
  const project = { id: projectSlug(value.name, all.map((p) => p.id)), ...value };
  return guarded(async () => {
    await db.transaction(async (tx) => {
      await tx.insert(projects).values({ id: project.id, name: project.name, description: project.description ?? null });
      await writeAudit(tx, { actor: actor(by), action: "Created project", detail: project.name, projectId: project.id });
    });
    return { ok: true, value: project };
  }, "Another project already has this name.");
}

export async function updateProject(id: string, input: Record<string, unknown>, by: SessionUser): Promise<AdminResult> {
  const all = await listProjects();
  const current = all.find((p) => p.id === id);
  if (!current) return missing("This project");
  const { violations, value } = validateProject(input, all.filter((p) => p.id !== id).map((p) => p.name));
  if (!value) return invalid(violations);
  return guarded(async () => {
    await db.transaction(async (tx) => {
      await tx.update(projects).set({ name: value.name, description: value.description ?? null }).where(eq(projects.id, id));
      await writeAudit(tx, { actor: actor(by), action: "Edited project", detail: value.name === current.name ? value.name : `${current.name} → ${value.name}`, projectId: id });
    });
    return { ok: true, value: { ...current, ...value } };
  }, "Another project already has this name.");
}

/** Only empty projects can go: runs, targets and scenarios are history someone may need to explain. */
export async function deleteProject(id: string, by: SessionUser): Promise<AdminResult> {
  const all = await listProjects();
  const project = all.find((p) => p.id === id);
  if (!project) return missing("This project");
  if (all.length === 1) return conflict("This is the only project. Create another one first.");
  const [[{ n: runCount }], [{ n: targetCount }], [{ n: scenarioCount }]] = await Promise.all([
    db.select({ n: count() }).from(runs).where(eq(runs.projectId, id)),
    db.select({ n: count() }).from(targets).where(eq(targets.projectId, id)),
    db.select({ n: count() }).from(scenarios).where(eq(scenarios.projectId, id)),
  ]);
  if (runCount) return conflict(`${project.name} has runs. Projects with history can't be deleted.`);
  if (targetCount || scenarioCount) return conflict(`Delete ${project.name}'s targets and scenarios first.`);
  await db.transaction(async (tx) => {
    await tx.delete(projects).where(eq(projects.id, id));
    await writeAudit(tx, { actor: actor(by), action: "Deleted project", detail: project.name, projectId: id });
  });
  return { ok: true, value: { id } };
}

export async function upsertTarget(projectId: string, input: Record<string, unknown>, by: SessionUser, editingId?: string): Promise<AdminResult> {
  const existing = (await getCatalog(projectId)).targets;
  const before = existing.find((t) => t.id === editingId);
  if (editingId && !before) return missing("This target");
  const { violations, value } = validateTarget(input, existing.map((t) => t.id), editingId);
  if (!value) return invalid(violations);

  const [row] = editingId ? await db.select({ id: targets.id }).from(targets).where(and(eq(targets.projectId, projectId), eq(targets.name, editingId))) : [];
  if (before && row && before.environment !== value.environment) {
    const [{ n }] = await db.select({ n: count() }).from(runs).where(eq(runs.targetId, row.id));
    if (n) return invalid([{ field: "environment", rule: "has_runs", message: "This target has runs on its current environment. Create a new target for the other one." }]);
  }

  const columns = {
    environment: value.environment,
    peakVus: value.referencePeak.vus,
    peakRps: value.referencePeak.rps,
    hosts: value.hosts,
    paths: value.paths,
    methods: value.methods,
    redirects: value.redirects,
    healthPath: value.healthPath,
    integrityPath: value.integrityPath,
  };
  return guarded(async () => {
    await db.transaction(async (tx) => {
      if (row) await tx.update(targets).set(columns).where(eq(targets.id, row.id));
      else await tx.insert(targets).values({ projectId, name: value.id, ...columns });
      await writeAudit(tx, {
        actor: actor(by),
        action: editingId ? "Edited target" : "Created target",
        detail: `${value.id} (${value.environment}) · peak ${value.referencePeak.vus} VUs / ${value.referencePeak.rps} RPS · ${value.hosts.join(", ")}`,
        projectId,
      });
    });
    return { ok: true, value };
  }, "This project already has a target with this name.");
}

export async function deleteTarget(projectId: string, id: string, by: SessionUser): Promise<AdminResult> {
  const [row] = await db.select({ id: targets.id }).from(targets).where(and(eq(targets.projectId, projectId), eq(targets.name, id)));
  if (!row) return missing("This target");
  const [used] = await db.select({ id: runs.id }).from(runs).where(eq(runs.targetId, row.id)).limit(1);
  if (used) return conflict(`${used.id} and other runs used ${id}. Targets with runs stay so their history makes sense.`);
  await db.transaction(async (tx) => {
    await tx.delete(testDataPools).where(eq(testDataPools.targetId, row.id));
    await tx.delete(targets).where(eq(targets.id, row.id));
    await writeAudit(tx, { actor: actor(by), action: "Deleted target", detail: id, projectId });
  });
  return { ok: true, value: { id } };
}

export async function updateCeiling(envId: string, input: Record<string, unknown>, by: SessionUser): Promise<AdminResult> {
  const env = ENVIRONMENTS.find((e) => e.id === envId);
  if (!env) return missing("This environment");
  const { violations, value } = validateCeiling(input);
  if (!value) return invalid(violations);
  await db.transaction(async (tx) => {
    await tx
      .update(environments)
      .set({ maxVus: value.vus, maxRps: value.rps, maxDurationSec: value.durationSec, maxRampPerMin: value.rampPerMin })
      .where(eq(environments.id, env.id));
    await writeAudit(tx, {
      actor: actor(by),
      action: "Changed ceilings",
      detail: `${env.label}: ${value.vus} VUs, ${value.rps} RPS, ${value.durationSec / 60} min, ramp ${value.rampPerMin}/min`,
    });
  });
  return { ok: true, value };
}

const roleText = (role: Role | null) => (role ? ROLE_LABEL[role] : "No access");

async function targetRow(projectId: string, name: string) {
  const [row] = await db.select({ id: targets.id, hosts: targets.hosts }).from(targets).where(and(eq(targets.projectId, projectId), eq(targets.name, name)));
  return row ?? null;
}

/** A pool changed mid-run would skip the run's cleanup or hand out other identities. */
async function activeRunOn(targetId: string) {
  const [row] = await db.select({ id: runs.id }).from(runs).where(and(eq(runs.targetId, targetId), inArray(runs.status, [...ACTIVE_STATUSES]))).limit(1);
  return row?.id ?? null;
}

export async function upsertPool(projectId: string, targetName: string, input: Record<string, unknown>, by: SessionUser): Promise<AdminResult> {
  const target = await targetRow(projectId, targetName);
  if (!target) return missing("This target");
  const { violations, value } = validatePool(input, target.hosts[0]);
  if (!value) return invalid(violations);
  const running = await activeRunOn(target.id);
  if (running) return conflict(`${running} is running on ${targetName}. Change the pool after it ends.`);
  const hooks = [value.seedHook && `seed ${value.seedHook.name}`, value.cleanupHook && `cleanup ${value.cleanupHook.name}`].filter(Boolean).join(", ");
  await db.transaction(async (tx) => {
    await tx
      .insert(testDataPools)
      .values({ targetId: target.id, ...value })
      .onConflictDoUpdate({ target: testDataPools.targetId, set: value });
    await writeAudit(tx, { actor: actor(by), action: "Changed test data pool", detail: `${targetName}: ${value.total} identities at ${value.secretPath}${hooks ? `; ${hooks}` : ""}`, projectId });
  });
  return { ok: true, value };
}

export async function deletePool(projectId: string, targetName: string, by: SessionUser): Promise<AdminResult> {
  const target = await targetRow(projectId, targetName);
  if (!target) return missing("This target");
  const running = await activeRunOn(target.id);
  if (running) return conflict(`${running} is running on ${targetName}. Remove the pool after it ends.`);
  const gone = await db.transaction(async (tx) => {
    const rows = await tx.delete(testDataPools).where(eq(testDataPools.targetId, target.id)).returning({ id: testDataPools.targetId });
    if (rows.length) await writeAudit(tx, { actor: actor(by), action: "Removed test data pool", detail: targetName, projectId });
    return rows.length > 0;
  });
  return gone ? { ok: true, value: { id: targetName } } : missing("This pool");
}

export async function addPerson(input: Record<string, unknown>, by: SessionUser): Promise<AdminResult> {
  const people = await listPeople();
  const { violations, value } = validatePerson(input, people.map((u) => u.email.toLowerCase()));
  if (!value) return invalid(violations);
  return guarded(async () => {
    const id = await db.transaction(async (tx) => {
      const [row] = await tx.insert(users).values(value).returning({ id: users.id });
      await writeAudit(tx, { actor: actor(by), action: "Added person", detail: `${value.name} (${value.email}) as ${value.role ? ROLE_LABEL[value.role] : "no access"}` });
      return row.id;
    });
    return { ok: true, value: { id, ...value, added: true } };
  }, "This person is already in the list.");
}

export async function changeRole(id: string, role: Role | null, by: SessionUser): Promise<AdminResult> {
  const person = await getUser(id);
  if (!person) return missing("This person");
  const admins = (await listPeople()).filter((u) => u.role === "admin").map((u) => u.id);
  const problem = roleChangeProblem(id, role, by.id, admins);
  if (problem) return conflict(problem);
  const value = { id: person.id, name: person.name, email: person.email, role };
  if (person.role === role) return { ok: true, value };
  await db.transaction(async (tx) => {
    await tx.update(users).set({ role }).where(eq(users.id, id));
    await writeAudit(tx, { actor: actor(by), action: "Changed role", detail: `${person.name}: ${roleText(person.role)} → ${roleText(role)}` });
  });
  return { ok: true, value };
}
