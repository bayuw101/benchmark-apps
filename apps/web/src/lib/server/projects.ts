import "server-only";

import { asc } from "drizzle-orm";
import { cookies } from "next/headers";

import { db, schema } from "@/db";
import { PROJECT_COOKIE, resolveProjectId, type Project } from "@/lib/projects";

export async function listProjects(): Promise<Project[]> {
  const rows = await db.select().from(schema.projects).orderBy(asc(schema.projects.createdAt), asc(schema.projects.name));
  return rows.map((p) => ({ id: p.id, name: p.name, description: p.description ?? undefined }));
}

/** Every project and the active one (from the untrusted cookie, falling back to the first). */
export async function activeProject() {
  const projects = await listProjects();
  const projectId = resolveProjectId((await cookies()).get(PROJECT_COOKIE)?.value, projects);
  const project = projects.find((p) => p.id === projectId) ?? null;
  return { projects, projectId, project };
}
