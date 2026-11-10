import type { RunnerCatalog } from "@btb/contracts";
import { sql } from "drizzle-orm";

import { journeys, runnerImages, type DbOrTx } from "./db";

const TAG_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Checks a catalog.json from a runner image build. Returns problems; empty = fine. */
export function catalogProblems(c: RunnerCatalog): string[] {
  const p: string[] = [];
  if (!c?.image || !TAG_RE.test(c.image.tag ?? "")) p.push("image.tag");
  if (c?.image?.protocol !== undefined && !(Number.isInteger(c.image.protocol) && c.image.protocol >= 1)) p.push("image.protocol");
  if (!Array.isArray(c?.journeys) || c.journeys.length === 0) p.push("journeys");
  else
    for (const j of c.journeys) {
      if (!ID_RE.test(j.id ?? "")) p.push(`journey id ${JSON.stringify(j.id)}`);
      if (!j.title || !j.version || !Array.isArray(j.steps) || !Array.isArray(j.params) || !Array.isArray(j.budgets)) p.push(`journey ${j.id} fields`);
    }
  return p;
}

/**
 * Loads a runner image's journey catalog (E2.2): records the image, then upserts every journey (last sync wins).
 * Journeys missing from the new image stay, because scenarios reference them; their image_tag shows they're stale.
 */
export async function syncCatalog(db: DbOrTx, catalog: RunnerCatalog, digest: string | null = null) {
  const problems = catalogProblems(catalog);
  if (problems.length) throw new Error(`invalid catalog: ${problems.join(", ")}`);
  const tag = catalog.image.tag;
  const protocol = catalog.image.protocol ?? 1;

  await db
    .insert(runnerImages)
    .values({ tag, digest, protocol })
    .onConflictDoUpdate({ target: runnerImages.tag, set: { digest, protocol, syncedAt: sql`now()` } });
  for (const j of catalog.journeys) {
    const row = { title: j.title, description: j.description, version: j.version, browser: j.browser, steps: j.steps, params: j.params, budgets: j.budgets, imageTag: tag };
    await db
      .insert(journeys)
      .values({ id: j.id, ...row })
      .onConflictDoUpdate({ target: journeys.id, set: { ...row, syncedAt: sql`now()` } });
  }
  return { tag, journeys: catalog.journeys.map((j) => j.id) };
}
