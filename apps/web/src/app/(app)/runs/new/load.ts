import "server-only";

import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/session";
import { getCatalog } from "@/lib/server/catalog";
import { activeProject } from "@/lib/server/projects";

/** What both the Create run page and the Create run sheet need. The API re-checks role and policy on submit. */
export async function loadCreateRun() {
  const user = await getSession();
  const { projectId, project } = await activeProject();
  const catalog = await getCatalog(projectId);
  const state = !user || !atLeast(user.role, "engineer") ? "forbidden" : !catalog.scenarios.length || !catalog.targets.length ? "not-ready" : "ok";
  return { project, catalog, state } as const;
}

export const BLOCKED_COPY = {
  forbidden: { title: "You can't create runs", description: "Creating runs needs the engineer role or higher. Ask a Benchmark admin if you need it." },
  "not-ready": { title: "This project isn't ready for runs", description: "A run needs at least one scenario and one target. An admin adds targets; scenarios come from the journey catalog." },
} as const;
