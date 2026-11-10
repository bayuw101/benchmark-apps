import { NextResponse } from "next/server";
import { scenarioInputSchema } from "@btb/contracts/schemas";

import { getCatalog } from "@/lib/server/catalog";
import { activeProject } from "@/lib/server/projects";
import { saveScenario } from "@/lib/server/scenarios";
import { validateScenario } from "@/lib/runs/scenarios";
import { withAuth } from "@/lib/server/with-auth";

/**
 * POST /api/scenarios — save a new scenario (v1) or a new version of one (PRD story 41). Engineer and above.
 * 400 when the body doesn't fit the shared zod schema; 422 lists every problem with its form field; a save that
 * changes nothing is a 422 too (versions are immutable).
 */
export const POST = withAuth(async (_request, { user, body: input }) => {
  const { projectId } = await activeProject();
  const catalog = await getCatalog(projectId);
  const { violations, resolved } = validateScenario(catalog, input);
  if (violations.length || !resolved) return NextResponse.json({ error: "invalid", violations }, { status: 422 });
  const saved = await saveScenario(projectId, catalog, resolved, user, new Date());
  if (!saved) return NextResponse.json({ error: "conflict", reason: "Someone saved this scenario at the same time. Reload and try again." }, { status: 409 });
  return NextResponse.json(saved, { status: 201 });
}, { role: "engineer", schema: scenarioInputSchema });
