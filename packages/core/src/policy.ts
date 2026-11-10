import {
  RUNNER_PROTOCOL,
  type Environment,
  type LoadModel,
  type NetworkProfile,
  type PolicyViolation,
  type Preset,
  type ProjectCatalog,
  type RunManifest,
  type Scenario,
  type ScenarioVersion,
  type Target,
} from "@btb/contracts";
import { runManifestSchema, type RunPlanInput } from "@btb/contracts/schemas";

/*
 * Run plan policy (PRD E2.4, E3.3, E4.1). Pure: the form runs it for the live preview,
 * the API runs it to decide, and the worker re-checks approvals with it. The server's answer is the one that counts.
 */

export interface PresetSpec {
  label: string;
  description: string;
  /** Multiple of the target's reference peak, or a fixed load when `fixed` is set. */
  factor: number;
  fixed?: number;
  durationSec: number;
  /** Time to reach full load; ramp rate = load / ramp. */
  rampSec: number;
  /** Needs an approver even on staging (D13). */
  risky: boolean;
}

// smoke is fixed per E2.4; PRD story 2 says relative. Open conflict, flip `fixed` if it resolves that way.
export const PRESETS: Record<Preset, PresetSpec> = {
  smoke: { label: "Smoke", description: "Fixed 5 users for 2 minutes. Checks the journey works.", factor: 0, fixed: 5, durationSec: 120, rampSec: 0, risky: false },
  baseline: { label: "Baseline", description: "Half of reference peak for 15 minutes.", factor: 0.5, durationSec: 900, rampSec: 120, risky: false },
  peak: { label: "Peak", description: "Reference peak for 15 minutes.", factor: 1, durationSec: 900, rampSec: 180, risky: false },
  spike: { label: "Spike", description: "Idle to 5× reference peak within 1 minute.", factor: 5, durationSec: 600, rampSec: 60, risky: true },
  stress: { label: "Stress", description: "Steps up to 2× reference peak over 20 minutes.", factor: 2, durationSec: 1200, rampSec: 300, risky: true },
  soak: { label: "Soak", description: "80% of reference peak for 4 hours.", factor: 0.8, durationSec: 14400, rampSec: 300, risky: true },
};

export const NETWORK_PROFILES: Record<NetworkProfile, { label: string; description: string }> = {
  "stadium-4g": { label: "Stadium 4G", description: "Network and CPU throttling of a phone on weak stadium signal." },
  "wifi-baseline": { label: "Wi-Fi baseline", description: "No throttling. The reference for browser timings." },
};

export const ENVIRONMENT_LABEL: Record<Environment, string> = { staging: "Staging", "prod-like": "Prod-like" };

export const UNIT: Record<LoadModel, string> = { vus: "VUs", rps: "RPS" };

/** Approvers a run needs (D13): 2 different people on prod-like, 1 for risky presets on staging, else auto. */
export function approversFor(environment: Environment, preset: Preset): 0 | 1 | 2 {
  return environment === "prod-like" ? 2 : PRESETS[preset].risky ? 1 : 0;
}

/** What the auto-approval row records as its rule. */
export const autoApprovalRule = (environment: Environment, preset: Preset) => `${PRESETS[preset].label} on ${environment} within ceilings`;

/** What the form sends (shape checked by the shared zod schema). Every field is optional so missing ones become violations, not crashes. */
export type { RunPlanInput };

export interface ResolvedPlan {
  scenario: Scenario;
  version: ScenarioVersion;
  target: Target;
  environment: Environment;
  preset: Preset;
  network: NetworkProfile | null;
  releaseId?: string;
  load: number;
  model: LoadModel;
  durationSec: number;
  rampSec: number;
  /** 0 = auto-approved. */
  approvers: 0 | 1 | 2;
}

export interface PlanResult {
  violations: PolicyViolation[];
  /** Null until scenario, target and preset are chosen. Present even when violations exist (for the preview). */
  plan: ResolvedPlan | null;
}

const isEnv = (v: unknown): v is Environment => v === "staging" || v === "prod-like";
const isPreset = (v: unknown): v is Preset => typeof v === "string" && v in PRESETS;
const isNetwork = (v: unknown): v is NetworkProfile => typeof v === "string" && v in NETWORK_PROFILES;
const RELEASE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const fmt = (n: number) => n.toLocaleString("en-US");

export function evaluatePlan(catalog: ProjectCatalog, input: RunPlanInput): PlanResult {
  const v: PolicyViolation[] = [];
  const add = (field: string, rule: string, message: string) => v.push({ field, rule, message });

  const scenario = catalog.scenarios.find((s) => s.name === input.scenario);
  if (!input.scenario) add("scenario", "required", "Choose a scenario.");
  else if (!scenario) add("scenario", "unknown", "This scenario isn't in the project's catalog.");

  const version = scenario?.versions.find((x) => x.version === input.version);
  if (scenario && input.version === undefined) add("version", "required", "Choose a version.");
  else if (scenario && !version) add("version", "unknown", `${scenario.name} has no v${input.version}.`);
  if (version && !version.thresholds) add("version", "missing_thresholds", "This version has no thresholds. Pick a version that defines them.");
  if (version && version.runnerProtocol < RUNNER_PROTOCOL)
    add("version", "outdated_runner", `Runner image ${version.imageVersion} can't check its own manifest before load. Save a new version to move it to the current image.`);

  const environment = isEnv(input.environment) ? input.environment : undefined;
  if (!input.environment) add("environment", "required", "Choose an environment.");
  else if (!environment) add("environment", "unknown", "Unknown environment.");

  const target = catalog.targets.find((x) => x.id === input.target);
  if (!input.target) add("target", "required", "Choose a target.");
  else if (!target || (environment && target.environment !== environment)) add("target", "not_allowed", "This target isn't allowed in the chosen environment.");

  const preset = isPreset(input.preset) ? input.preset : undefined;
  if (!input.preset) add("preset", "required", "Choose a load preset.");
  else if (!preset) add("preset", "unknown", "Unknown load preset.");

  let network: NetworkProfile | null = null;
  if (version?.browser) {
    if (!input.network) add("network", "required", "Choose a network profile for the browser steps.");
    else if (!isNetwork(input.network)) add("network", "unknown", "Unknown network profile.");
    else network = input.network;
  }

  const releaseId = input.releaseId?.trim() || undefined;
  if (releaseId && !RELEASE_RE.test(releaseId)) add("releaseId", "format", "Use up to 40 letters, digits, dots, dashes or underscores.");

  if (!scenario || !version || !target || !preset || !environment || target.environment !== environment) return { violations: v, plan: null };

  const spec = PRESETS[preset];
  const model = version.model;
  const load = spec.fixed ?? Math.round(target.referencePeak[model] * spec.factor);
  // Ceilings come with the catalog, so the form's preview and the server use the same (admin-edited) values.
  const ceiling = catalog.ceilings[environment];
  const unit = UNIT[model];

  if (environment === "prod-like" && (preset === "soak" || preset === "stress")) add("preset", "staging_only", `${spec.label} runs only on staging.`);
  if (load > ceiling[model]) add("preset", `${model}_ceiling`, `${fmt(load)} ${unit} is over the ${ENVIRONMENT_LABEL[environment].toLowerCase()} ceiling of ${fmt(ceiling[model])} ${unit}.`);
  if (spec.durationSec > ceiling.durationSec) add("preset", "duration", `Runs on ${ENVIRONMENT_LABEL[environment].toLowerCase()} can last at most ${ceiling.durationSec / 60} minutes.`);
  const rampPerMin = spec.rampSec ? Math.round(load / (spec.rampSec / 60)) : 0;
  if (rampPerMin > ceiling.rampPerMin) add("preset", "ramp_rate", `Ramps ${fmt(rampPerMin)} ${unit} per minute; the limit is ${fmt(ceiling.rampPerMin)}.`);

  const approvers = approversFor(environment, preset);
  return {
    violations: v,
    plan: { scenario, version, target, environment, preset, network, releaseId, load, model, durationSec: spec.durationSec, rampSec: spec.rampSec, approvers },
  };
}

/**
 * The manifest approvals are bound to (E3.2). Keys are written in a fixed order so equal plans hash equally.
 * Parsed with the shared zod schema: a plan the policy let through but the contract doesn't allow is a bug, not a run.
 */
export function manifestOf(projectId: string, p: ResolvedPlan): RunManifest {
  return runManifestSchema.parse({
    projectId,
    scenario: { name: p.scenario.name, journey: p.scenario.journey, version: p.version.version, imageVersion: p.version.imageVersion },
    params: p.version.params,
    environment: p.environment,
    target: p.target.id,
    preset: p.preset,
    load: { model: p.model, target: p.load, durationSec: p.durationSec, rampSec: p.rampSec },
    network: p.network,
    thresholds: p.version.thresholds ? { ...p.version.thresholds, abortOnFail: true as const } : null,
    releaseId: p.releaseId ?? null,
  });
}
