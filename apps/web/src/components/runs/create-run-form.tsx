"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CircleCheck,
  Info,
  Plus,
  Tag,
  TriangleAlert,
} from "lucide-react";

import { formatDuration } from "@/lib/time";
import type { ProjectCatalog } from "@/lib/runs/catalog";
import {
  ENVIRONMENT_LABEL,
  NETWORK_PROFILES,
  PRESETS,
  UNIT,
  evaluatePlan,
  type ResolvedPlan,
  type RunPlanInput,
} from "@btb/core/policy";
import { parseWith, runPlanInputSchema } from "@btb/contracts/schemas";
import type {
  Environment,
  PolicyViolation,
  RunDetail,
  RunListItem,
} from "@/lib/runs/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/arbiter/input-field";
import {
  RightPullSheet,
  SheetCancel,
} from "@/components/arbiter/right-pull-sheet";
import { SelectField } from "@/components/arbiter/select-field";
import { notify } from "@/components/arbiter/toast";
import { PolicyViolations } from "@/components/btb/policy-violations";
import { useNavigate } from "@/components/navigation";

const FORM_ID = "create-run-form";
const fmt = (n: number) => n.toLocaleString("en-US");
const fieldId = (name: string) => `create-run-${name}`;
const FIELD_ORDER = [
  "scenario",
  "version",
  "environment",
  "target",
  "preset",
  "network",
  "releaseId",
];

const APPROVAL = {
  0: {
    tone: "success",
    label: "Auto-approved",
    text: "Smoke, baseline and peak on staging start without an approver. Start it from the run page.",
  },
  1: {
    tone: "warning",
    label: "1 approver",
    text: "Needs one person with the approver role who isn't you.",
  },
  2: {
    tone: "warning",
    label: "2 approvers",
    text: "Every prod-like run needs two different approvers, neither of them you.",
  },
} as const;

class CreateRunError extends Error {
  constructor(
    readonly status: number,
    readonly violations: PolicyViolation[] = [],
  ) {
    super(`create run failed: ${status}`);
  }
}

/** POST a new run, or PATCH an existing one (Edit). */
async function saveRun(
  input: RunPlanInput,
  runId?: string,
): Promise<RunListItem | RunDetail> {
  const url = runId
    ? `/api/runs/${encodeURIComponent(runId)}`
    : `/api/runs${location.search.includes("simulate=error") ? "?simulate=error" : ""}`;
  const res = await fetch(url, {
    method: runId ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.ok) return res.json();
  const body = await res.json().catch(() => ({}));
  throw new CreateRunError(
    res.status,
    Array.isArray(body.violations) ? body.violations : [],
  );
}

/** A titled group of fields (plain: the sheet is already a card). */
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-3">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

interface CreateRunFormProps {
  catalog: ProjectCatalog;
  projectName: string;
  /** Starting values (Edit). */
  initial?: RunPlanInput;
  /** Sheet opened by loading /runs/new directly (or a refresh): no in-app page to go back to, so closing goes to /runs. */
  direct?: boolean;
  /** Edit an existing run instead of creating one. `voids` = approvals that stop counting. */
  edit?: {
    runId: string;
    voids: number;
    onClose: () => void;
    onSaved: (detail: RunDetail) => void;
  };
}

/**
 * UI-04 Create run, in a wide right sheet (also used for Edit). The summary runs the same policy code as the API, so it shows what the server will
 * decide; the server's 422 still wins and lands next to each field. After saving, the Runs list opens
 * with the new run highlighted (the sheet closes because /runs has no sheet).
 */
export function CreateRunForm({
  catalog,
  projectName,
  initial,
  edit,
  direct,
}: CreateRunFormProps) {
  const nav = useNavigate();
  const queryClient = useQueryClient();
  const environments = (["staging", "prod-like"] as Environment[]).filter((e) =>
    catalog.targets.some((t) => t.environment === e),
  );

  const [input, setInput] = React.useState<RunPlanInput>(() => ({
    network: "stadium-4g",
    ...(initial ?? { environment: environments[0] }),
  }));
  const [submitted, setSubmitted] = React.useState(false);
  const [serverViolations, setServerViolations] = React.useState<
    PolicyViolation[]
  >([]);

  const { violations, plan } = evaluatePlan(catalog, input);
  const scenario = catalog.scenarios.find((s) => s.name === input.scenario);
  const version = scenario?.versions.find((v) => v.version === input.version);
  // "Choose a …" errors wait for the first submit; policy problems show as soon as they exist.
  const shown = [
    ...(submitted
      ? violations
      : violations.filter((v) => v.rule !== "required")),
    ...serverViolations,
  ];
  const errorFor = (field: string) => {
    const messages = [
      ...new Set(shown.filter((v) => v.field === field).map((v) => v.message)),
    ];
    return messages.length ? messages.join(" ") : undefined;
  };
  const policyProblems = [
    ...violations.filter((v) => v.rule !== "required"),
    ...serverViolations,
  ].filter(
    (v, i, all) =>
      all.findIndex((x) => x.field === v.field && x.rule === v.rule) === i,
  );

  function set(patch: Partial<RunPlanInput>) {
    setServerViolations([]);
    setInput((prev) => {
      const next = { ...prev, ...patch };
      // A new scenario starts on its latest version; a new environment drops a target it doesn't allow.
      if ("scenario" in patch)
        next.version = catalog.scenarios.find((s) => s.name === patch.scenario)
          ?.versions[0]?.version;
      if (
        "environment" in patch &&
        !catalog.targets.some(
          (t) => t.id === next.target && t.environment === next.environment,
        )
      )
        next.target = undefined;
      return next;
    });
  }

  const create = useMutation({
    mutationFn: (plan: RunPlanInput) => saveRun(plan, edit?.runId),
    onSuccess: (run) => {
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
      if (edit) {
        const voids = edit.voids;
        notify.success(
          `${run.id} updated`,
          voids
            ? `New hash. ${voids} earlier ${voids === 1 ? "approval no longer counts" : "approvals no longer count"}.`
            : "New hash saved.",
        );
        edit.onSaved(run as RunDetail);
        return;
      }
      notify.success(
        `${run.id} created`,
        run.status === "pending_approval"
          ? `Waiting for ${run.approvals?.required === 2 ? "2 approvers" : "an approver"}.`
          : "Auto-approved. Start it from the run page.",
      );
      nav.replace(`/runs?created=${encodeURIComponent(run.id)}`);
    },
    onError: (error) => {
      if (error instanceof CreateRunError && error.status === 422) {
        setSubmitted(true);
        setServerViolations(error.violations);
        notify.error(
          "The policy rejected this run",
          "Fix the marked fields and try again.",
        );
      } else if (error instanceof CreateRunError && error.status === 403) {
        notify.error(
          "You can't create runs",
          "Creating runs needs the engineer role or higher.",
        );
      } else {
        notify.error(
          "Couldn't create the run",
          "The run service didn't answer. Your form is kept; try again.",
        );
      }
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (violations.length) {
      const first = FIELD_ORDER.find((f) =>
        violations.some((v) => v.field === f),
      );
      if (first) document.getElementById(fieldId(first))?.focus();
      return;
    }
    // The same zod schema the API parses the body with (PRD E1.2): what fails here would be a 400 there.
    const parsed = parseWith(runPlanInputSchema, {
      ...input,
      network: version?.browser ? input.network : undefined,
    });
    if (!parsed.ok) {
      setServerViolations(parsed.violations);
      return;
    }
    create.mutate(parsed.data);
  }

  const targets = catalog.targets.filter(
    (t) => t.environment === input.environment,
  );
  const environment = input.environment as Environment | undefined;

  const fields = (
    <>
      <Section
        title="Scenario"
        description="What to run. A published version never changes."
      >
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
          <SelectField
            id={fieldId("scenario")}
            label="Scenario"
            value={input.scenario ?? ""}
            onChange={(v) => set({ scenario: v })}
            options={catalog.scenarios.map((s) => ({
              value: s.name,
              label: s.name,
              description: `${s.journey}${s.versions[0]?.browser ? " · browser steps" : ""}`,
            }))}
            error={errorFor("scenario")}
          />
          <SelectField
            id={fieldId("version")}
            label="Version"
            value={input.version ? String(input.version) : ""}
            onChange={(v) => set({ version: Number(v) })}
            options={(scenario?.versions ?? []).map((v, i) => ({
              value: String(v.version),
              label: `v${v.version}${i === 0 ? " · latest" : ""}`,
              description: v.thresholds ? undefined : "No thresholds",
            }))}
            disabled={!scenario}
            error={errorFor("version")}
          />
        </div>
      </Section>

      <Section
        title="Where"
        description="A run only reaches hosts on the target's allowlist."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            id={fieldId("environment")}
            label="Environment"
            value={input.environment ?? ""}
            onChange={(v) => set({ environment: v })}
            options={environments.map((e) => ({
              value: e,
              label: ENVIRONMENT_LABEL[e],
              description:
                e === "prod-like"
                  ? "Every run needs 2 approvers"
                  : "Spike, stress and soak need 1 approver",
            }))}
            error={errorFor("environment")}
          />
          <SelectField
            id={fieldId("target")}
            label="Target"
            value={input.target ?? ""}
            onChange={(v) => set({ target: v })}
            options={targets.map((t) => ({
              value: t.id,
              label: t.name,
              description: `Reference peak ${fmt(t.referencePeak.vus)} VUs · ${fmt(t.referencePeak.rps)} RPS`,
            }))}
            disabled={!targets.length}
            error={errorFor("target")}
          />
        </div>
      </Section>

      <Section
        title="Load"
        description="Sized from the target's reference peak. Environment ceilings still apply."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            id={fieldId("preset")}
            label="Load preset"
            value={input.preset ?? ""}
            onChange={(v) => set({ preset: v })}
            options={Object.entries(PRESETS)
              .filter(
                ([key]) =>
                  environment !== "prod-like" ||
                  (key !== "soak" && key !== "stress"),
              )
              .map(([key, p]) => ({
                value: key,
                label: p.label,
                description: p.description,
              }))}
            error={errorFor("preset")}
          />
          <SelectField
            id={fieldId("network")}
            label="Network profile"
            value={version?.browser ? (input.network ?? "") : ""}
            onChange={(v) => set({ network: v })}
            options={Object.entries(NETWORK_PROFILES).map(([key, n]) => ({
              value: key,
              label: n.label,
              description: n.description,
            }))}
            disabled={!version?.browser}
            hint={
              version?.browser
                ? undefined
                : "Only for scenarios with browser steps."
            }
            error={errorFor("network")}
          />
        </div>
      </Section>

      <Section title="Tracking">
        <InputField
          id={fieldId("releaseId")}
          label="Release ID (optional)"
          icon={<Tag />}
          value={input.releaseId ?? ""}
          onChange={(e) => set({ releaseId: e.target.value })}
          hint="Compare results between releases, e.g. 2026.11.1. Leaving it empty never blocks a run."
          error={errorFor("releaseId")}
        />
      </Section>
    </>
  );

  const policy =
    plan || policyProblems.length ? (
      <div className="grid gap-2">
        <span className="text-xs font-semibold">Policy check</span>
        {policyProblems.length ? (
          <PolicyViolations violations={policyProblems} />
        ) : plan ? (
          <p className="flex items-start gap-1.5 text-xs text-success">
            <CircleCheck className="mt-px size-3.5 shrink-0" />
            Within {ENVIRONMENT_LABEL[
              plan.environment
            ].toLowerCase()} limits:{" "}
            {fmt(catalog.ceilings[plan.environment][plan.model])} {UNIT[plan.model]},{" "}
            {formatDuration(catalog.ceilings[plan.environment].durationSec * 1000)}.
          </p>
        ) : null}
      </div>
    ) : null;

  const createButton = (
    <Button
      type="submit"
      form={FORM_ID}
      icon={edit ? <Check /> : <Plus />}
      loading={create.isPending || nav.pending}
    >
      {edit ? "Save changes" : "Create run"}
    </Button>
  );

  return (
    <RightPullSheet
      open
      wide
      title={edit ? `Edit ${edit.runId}` : "Create run"}
      subtitle={projectName}
      // Closing goes back to the list underneath (the URL was /runs/new while the sheet was open).
      onClose={
        edit?.onClose ?? (() => (direct ? nav.replace("/runs") : nav.back()))
      }
      footer={
        // Phones: the plan summary on its own row, then Cancel and the primary action side by side, full width.
        // From sm: summary left, buttons right.
        <div className="grid w-full gap-3 sm:flex sm:items-center sm:justify-between sm:gap-4">
          <SheetPlanLine plan={plan} problems={policyProblems.length} />
          <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
            <SheetCancel />
            {createButton}
          </div>
        </div>
      }
    >
      <form id={FORM_ID} noValidate onSubmit={submit} className="grid gap-6">
        {edit ? (
          <p
            className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${edit.voids ? "border-warning/30 bg-warning-soft text-warning" : "border-border bg-muted text-muted-foreground"}`}
          >
            {edit.voids ? (
              <TriangleAlert className="mt-px size-3.5 shrink-0" />
            ) : (
              <Info className="mt-px size-3.5 shrink-0" />
            )}
            {edit.voids
              ? `Saving creates a new manifest hash. The ${edit.voids === 1 ? "approval" : `${edit.voids} approvals`} given so far will stop counting, and the run goes back for approval.`
              : "Saving creates a new manifest hash. Approval is decided again from the new plan."}
          </p>
        ) : null}
        {fields}
        {policy ? (
          <div className="border-t border-border pt-5">{policy}</div>
        ) : null}
      </form>
    </RightPullSheet>
  );
}

function planDetail(plan: ResolvedPlan) {
  return [
    PRESETS[plan.preset].label,
    formatDuration(plan.durationSec * 1000),
    plan.rampSec
      ? `full load after ${formatDuration(plan.rampSec * 1000)}`
      : null,
    plan.network ? NETWORK_PROFILES[plan.network].label : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The sheet's footer summary: load, approval and policy at a glance (details sit in the form). */
function SheetPlanLine({
  plan,
  problems,
}: {
  plan: ResolvedPlan | null;
  problems: number;
}) {
  if (!plan)
    return (
      <span className="text-xs text-muted-foreground">
        Choose a scenario, target and preset to see the load.
      </span>
    );
  return (
    <div aria-live="polite" className="grid min-w-0 gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base leading-5 font-semibold tabular-nums">
          {fmt(plan.load)}{" "}
          <span className="text-xs font-medium text-muted-foreground">
            {UNIT[plan.model]}
          </span>
        </span>
        <Badge tone={APPROVAL[plan.approvers].tone} dot>
          {APPROVAL[plan.approvers].label}
        </Badge>
        {problems ? (
          <Badge tone="danger">
            <TriangleAlert />
            {problems} policy {problems === 1 ? "problem" : "problems"}
          </Badge>
        ) : null}
      </div>
      <span className="truncate text-xs text-muted-foreground">
        {planDetail(plan)}
      </span>
    </div>
  );
}

/** The sheet with a message instead of the form (no access, or the project has nothing to run). */
export function CreateRunSheetMessage({
  projectName,
  title,
  description,
  direct,
}: {
  projectName: string;
  title: string;
  description: string;
  direct?: boolean;
}) {
  const nav = useNavigate();
  return (
    <RightPullSheet
      open
      title="Create run"
      subtitle={projectName}
      onClose={() => (direct ? nav.replace("/runs") : nav.back())}
      footer={<SheetCancel>Close</SheetCancel>}
    >
      <div className="grid gap-1 rounded-lg border border-dashed border-border-strong bg-accent p-6 text-center">
        <div className="text-sm font-semibold">{title}</div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </RightPullSheet>
  );
}
