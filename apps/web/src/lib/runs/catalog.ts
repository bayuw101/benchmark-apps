import type { JourneyMeta, ProjectCatalog } from "@btb/contracts";

/*
 * What a project can run: environments with their targets, versioned scenarios, and the journey catalog
 * (PRD E2.1–E2.3). Loaded from Postgres by lib/server/catalog.ts. The shapes live in @btb/contracts
 * because the policy in @btb/core reads them.
 */

export { HTTP_METHODS } from "@btb/contracts";
export type { HttpMethod, JourneyParam, LoadModel, ParamValue, ProjectCatalog, RunnerImage, Scenario, ScenarioVersion, Target, Thresholds } from "@btb/contracts";

/** A journey from the runner image's catalog: read-only in the UI (E2.2, story 41). */
export type Journey = JourneyMeta;

export const journeyOf = (catalog: Pick<ProjectCatalog, "journeys">, id: string) => catalog.journeys.find((j) => j.id === id);
