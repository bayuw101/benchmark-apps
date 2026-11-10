import type { ScenarioInput } from "@btb/contracts/schemas";

import { journeyOf, type LoadModel, type ParamValue, type ProjectCatalog, type ScenarioVersion } from "./catalog";
import type { PolicyViolation } from "./types";

/*
 * Scenario rules (UI-06, PRD E2.3 / story 41). A version never changes: every save is a new version, and a
 * save that changes nothing is refused. Pure, so the form and the API share the rules (lib/server/scenarios.ts saves).
 */

/** What the form sends (shape: the shared zod schema). `scenario` set = a new version of it; otherwise a new scenario named `name`. */
export type { ScenarioInput };

export interface ResolvedScenario {
  name: string;
  journey: string;
  isNew: boolean;
  model: LoadModel;
  params: Record<string, ParamValue>;
  thresholds: { p95Ms: number; errorRatePct: number };
  note?: string;
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{2,39}$/;
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);

export function validateScenario(catalog: ProjectCatalog, input: ScenarioInput): { violations: PolicyViolation[]; resolved: ResolvedScenario | null } {
  const v: PolicyViolation[] = [];
  const add = (field: string, rule: string, message: string) => v.push({ field, rule, message });

  const existing = input.scenario ? catalog.scenarios.find((s) => s.name === input.scenario) : undefined;
  if (input.scenario && !existing) add("scenario", "unknown", "This scenario doesn't exist in the project.");

  const name = existing?.name ?? input.name?.trim() ?? "";
  if (!existing) {
    if (!name) add("name", "required", "Name the scenario.");
    else if (!NAME_RE.test(name)) add("name", "format", "Use 3–40 letters, digits, spaces, dots, dashes or underscores.");
    else if (catalog.scenarios.some((s) => s.name.toLowerCase() === name.toLowerCase())) add("name", "taken", "A scenario with this name already exists. Save a new version of it instead.");
  }

  // A new version keeps its scenario's journey; a different journey is a different scenario.
  const journey = journeyOf(catalog, existing?.journey ?? input.journey ?? "");
  if (!existing && !input.journey) add("journey", "required", "Choose a journey.");
  else if (!journey) add("journey", "unknown", "This journey isn't in the catalog.");

  const model = input.model === "vus" || input.model === "rps" ? input.model : undefined;
  if (!model) add("model", "required", "Choose a load model.");

  const params: Record<string, ParamValue> = {};
  if (journey) {
    const given = input.params ?? {};
    for (const key of Object.keys(given)) if (!journey.params.some((jp) => jp.name === key)) add(`params.${key}`, "unknown", `${journey.id} has no parameter "${key}".`);
    for (const jp of journey.params) {
      const raw = given[jp.name] ?? jp.default;
      const field = `params.${jp.name}`;
      if (jp.type === "number") {
        const n = num(raw);
        if (!Number.isFinite(n)) add(field, "type", "Enter a number.");
        else if ((jp.min !== undefined && n < jp.min) || (jp.max !== undefined && n > jp.max)) add(field, "range", `Use ${jp.min} to ${jp.max}${jp.unit ? ` ${jp.unit}` : ""}.`);
        else params[jp.name] = n;
      } else if (jp.type === "boolean") {
        if (typeof raw !== "boolean") add(field, "type", "Choose on or off.");
        else params[jp.name] = raw;
      } else {
        const s = typeof raw === "string" ? raw.trim() : "";
        if (!s || s.length > 80) add(field, "required", "Enter a value (up to 80 characters).");
        else params[jp.name] = s;
      }
    }
  }

  // abortOnFail on p95 and error rate is mandatory on every run (E6.3), so both are required here.
  const p95Ms = num(input.p95Ms);
  if (!Number.isInteger(p95Ms) || p95Ms < 50 || p95Ms > 60_000) add("p95Ms", "range", "Use a whole number from 50 to 60,000 ms.");
  const errorRatePct = num(input.errorRatePct);
  if (!Number.isFinite(errorRatePct) || errorRatePct <= 0 || errorRatePct > 50) add("errorRatePct", "range", "Use more than 0 and up to 50%.");

  const note = input.note?.trim() || undefined;
  if (note && note.length > 140) add("note", "length", "Keep the note under 140 characters.");

  if (!catalog.image) add("form", "no_image", "No runner image has been synced yet. Run `pnpm catalog:sync` first.");

  if (v.length || !journey || !model || !catalog.image) return { violations: v, resolved: null };
  const resolved: ResolvedScenario = { name, journey: journey.id, isNew: !existing, model, params, thresholds: { p95Ms, errorRatePct }, note };

  // Moving to the current runner image counts as a change: the image version is recorded on every run.
  if (existing && diffVersion(existing.versions[0], { ...resolved, imageVersion: catalog.image.tag }).length === 0) {
    return { violations: [{ field: "form", rule: "no_change", message: `Nothing changed from v${existing.versions[0].version}. Change something to save a new version.` }], resolved: null };
  }
  return { violations: [], resolved };
}

/** Human-readable changes between two versions ("Think time 3 → 5 s"), newest compared to older. */
export function diffVersion(older: ScenarioVersion | undefined, newer: Pick<ScenarioVersion, "model" | "params"> & { thresholds: ScenarioVersion["thresholds"]; imageVersion?: string }) {
  if (!older) return [];
  const changes: string[] = [];
  if (older.model !== newer.model) changes.push(`Load model ${modelLabel(older.model)} → ${modelLabel(newer.model)}`);
  const keys = [...new Set([...Object.keys(older.params), ...Object.keys(newer.params)])];
  for (const k of keys) if (older.params[k] !== newer.params[k]) changes.push(`${k} ${fmt(older.params[k])} → ${fmt(newer.params[k])}`);
  const a = older.thresholds;
  const b = newer.thresholds;
  if (a?.p95Ms !== b?.p95Ms) changes.push(`p95 threshold ${a ? `${a.p95Ms} ms` : "none"} → ${b ? `${b.p95Ms} ms` : "none"}`);
  if (a?.errorRatePct !== b?.errorRatePct) changes.push(`Error-rate threshold ${a ? `${a.errorRatePct}%` : "none"} → ${b ? `${b.errorRatePct}%` : "none"}`);
  if (newer.imageVersion && older.imageVersion !== newer.imageVersion) changes.push(`Runner image ${older.imageVersion} → ${newer.imageVersion}`);
  return changes;
}

export const modelLabel = (m: LoadModel) => (m === "vus" ? "virtual users" : "arrival rate");
const fmt = (v: ParamValue | undefined) => (v === undefined ? "—" : typeof v === "boolean" ? (v ? "on" : "off") : String(v));
