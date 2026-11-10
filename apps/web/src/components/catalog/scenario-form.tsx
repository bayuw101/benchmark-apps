"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Info, Plus } from "lucide-react";

import { journeyOf, type ProjectCatalog, type Scenario } from "@/lib/runs/catalog";
import { diffVersion, validateScenario, type ScenarioInput } from "@/lib/runs/scenarios";
import { parseWith, scenarioInputSchema } from "@btb/contracts/schemas";
import type { PolicyViolation } from "@/lib/runs/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { InputField } from "@/components/arbiter/input-field";
import { RightPullSheet, SheetCancel } from "@/components/arbiter/right-pull-sheet";
import { SelectField } from "@/components/arbiter/select-field";
import { notify } from "@/components/arbiter/toast";

const FORM_ID = "scenario-form";
const fieldId = (name: string) => `scenario-${name.replace(".", "-")}`;

class SaveError extends Error {
  constructor(readonly status: number, readonly violations: PolicyViolation[] = []) {
    super(`save failed: ${status}`);
  }
}

async function postScenario(input: ScenarioInput): Promise<{ scenario: string; version: { version: number } }> {
  const res = await fetch("/api/scenarios", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  if (res.ok) return res.json();
  const body = await res.json().catch(() => ({}));
  throw new SaveError(res.status, Array.isArray(body.violations) ? body.violations : []);
}

function Group({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * New scenario (v1) or a new version of `base`. Versions never change, so saving is always a new version;
 * the footer says which version it will be and what changed. `onSaved` runs once the save succeeded.
 */
export function ScenarioForm({
  catalog, projectName, base, onClose, onSaved, saving,
}: {
  catalog: ProjectCatalog;
  projectName: string;
  /** Edit = new version of this scenario. */
  base?: Scenario;
  onClose: () => void;
  onSaved: (saved: { scenario: string; version: number }) => void;
  /** The caller's follow-up (navigation/refresh) is under way: keep the button spinning. */
  saving?: boolean;
}) {
  const latest = base?.versions[0];
  const [input, setInput] = React.useState<ScenarioInput>(() =>
    latest
      ? {
          scenario: base!.name,
          model: latest.model,
          params: { ...latest.params },
          p95Ms: String(latest.thresholds?.p95Ms ?? 800),
          errorRatePct: String(latest.thresholds?.errorRatePct ?? 1),
        }
      : { model: "vus", params: {}, p95Ms: "800", errorRatePct: "1" },
  );
  const [submitted, setSubmitted] = React.useState(false);
  const [serverViolations, setServerViolations] = React.useState<PolicyViolation[]>([]);

  const journey = journeyOf(catalog, base?.journey ?? input.journey ?? "");
  const { violations, resolved } = validateScenario(catalog, input);
  const shown = [...(submitted ? violations : violations.filter((v) => v.rule !== "required" && v.rule !== "no_change")), ...serverViolations];
  const errorFor = (field: string) => {
    const m = [...new Set(shown.filter((v) => v.field === field).map((v) => v.message))];
    return m.length ? m.join(" ") : undefined;
  };
  const changes = latest && resolved ? diffVersion(latest, { ...resolved, imageVersion: catalog.image?.tag ?? "" }) : [];
  const noChange = !!latest && violations.some((v) => v.rule === "no_change");
  const nextVersion = (latest?.version ?? 0) + 1;

  function set(patch: Partial<ScenarioInput>) {
    setServerViolations([]);
    setInput((prev) => ({ ...prev, ...patch }));
  }
  const setParam = (name: string, value: string | boolean) => set({ params: { ...input.params, [name]: value } });

  const save = useMutation({
    mutationFn: postScenario,
    onSuccess: (r) => {
      notify.success(`${r.scenario} v${r.version.version} saved`, base ? "Earlier versions stay as they were." : "Pick it when you create a run.");
      onSaved({ scenario: r.scenario, version: r.version.version });
    },
    onError: (error) => {
      if (error instanceof SaveError && error.status === 422) {
        setSubmitted(true);
        setServerViolations(error.violations);
        notify.error("Couldn't save the scenario", error.violations.find((v) => v.field === "form")?.message ?? "Fix the marked fields and try again.");
      } else if (error instanceof SaveError && error.status === 403) {
        notify.error("You can't edit scenarios", "Saving scenarios needs the engineer role or higher.");
      } else {
        notify.error("Couldn't save the scenario", "The catalog service didn't answer. Your changes are kept; try again.");
      }
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (violations.length) {
      const first = violations.find((v) => v.field !== "form");
      if (first) document.getElementById(fieldId(first.field))?.focus();
      // "Nothing changed" has no field to point at: the always-visible footer badge says it (a toast would
      // sit on top of the Save button).
      return;
    }
    // The same zod schema the API parses the body with (PRD E1.2).
    const parsed = parseWith(scenarioInputSchema, input);
    if (!parsed.ok) {
      setServerViolations(parsed.violations);
      return;
    }
    save.mutate(parsed.data);
  }

  const paramValue = (name: string, fallback: unknown) => input.params?.[name] ?? fallback;

  return (
    <RightPullSheet
      open
      wide
      title={base ? `New version of ${base.name}` : "New scenario"}
      subtitle={projectName}
      onClose={onClose}
      footer={
        <div className="grid w-full gap-3 sm:flex sm:items-center sm:justify-between sm:gap-4">
          <div aria-live="polite" className="grid min-w-0 gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base leading-5 font-semibold">v{nextVersion}</span>
              {latest ? (
                noChange ? (
                  submitted ? <Badge tone="danger">Nothing changed</Badge> : <Badge>No changes yet</Badge>
                ) : changes.length ? <Badge tone="info">{changes.length} {changes.length === 1 ? "change" : "changes"}</Badge> : null
              ) : (
                <Badge tone="info">New</Badge>
              )}
            </div>
            <span className="truncate text-xs text-muted-foreground">
              {catalog.image ? `Saved against ${catalog.image.name}:${catalog.image.tag}` : "No runner image synced yet"}
              {latest ? `. v${latest.version} stays as it is.` : "."}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
            <SheetCancel />
            <Button type="submit" form={FORM_ID} icon={base ? <Check /> : <Plus />} loading={save.isPending || saving}>
              {base ? `Save v${nextVersion}` : "Create scenario"}
            </Button>
          </div>
        </div>
      }
    >
      <form id={FORM_ID} noValidate onSubmit={submit} className="grid gap-6">
        {base ? (
          <p className="flex items-start gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-px size-3.5 shrink-0" />
            Versions never change. Saving creates v{nextVersion}; runs already made with v{latest?.version} keep using it.
          </p>
        ) : null}

        <Group title="Scenario" description={base ? "A new version keeps its journey. A different journey is a different scenario." : "A journey from the catalog, plus how to load it."}>
          {base ? (
            <div className="rounded-lg border border-border px-3 py-2.5 text-sm">
              <span className="font-mono text-xs text-muted-foreground">journey</span> {journey?.title}{" "}
              <span className="font-mono text-xs text-muted-foreground">
                {journey?.id} {journey?.version}
              </span>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <InputField id={fieldId("name")} label="Name" value={input.name ?? ""} onChange={(e) => set({ name: e.target.value })} error={errorFor("name")} />
              <SelectField
                id={fieldId("journey")}
                label="Journey"
                value={input.journey ?? ""}
                onChange={(v) => set({ journey: v, params: {} })}
                options={catalog.journeys.map((j) => ({ value: j.id, label: j.title, description: `${j.id} ${j.version} · ${j.browser ? "browser steps" : "protocol"}` }))}
                error={errorFor("journey")}
              />
            </div>
          )}
          <SelectField
            id={fieldId("model")}
            label="Load model"
            value={input.model ?? ""}
            onChange={(v) => set({ model: v })}
            options={[
              { value: "vus", label: "Closed: virtual users", description: "A fixed number of users loop through the journey." },
              { value: "rps", label: "Open: arrival rate", description: "New iterations start at a fixed rate, however fast the target answers." },
            ]}
            hint="Presets size the load from the target's reference peak when you create a run."
            error={errorFor("model")}
          />
        </Group>

        {journey ? (
          <Group title="Parameters" description={`From the ${journey.id} journey's schema.`}>
            <div className="grid gap-3 sm:grid-cols-2">
              {journey.params.map((jp) =>
                jp.type === "boolean" ? (
                  <label key={jp.name} htmlFor={fieldId(`params.${jp.name}`)} className="flex min-h-11 cursor-pointer items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                    <span className="grid gap-0.5">
                      <span className="font-mono text-xs">{jp.name}</span>
                      <span className="text-micro text-muted-foreground">{jp.description}</span>
                    </span>
                    <Switch id={fieldId(`params.${jp.name}`)} checked={paramValue(jp.name, jp.default) === true} onCheckedChange={(c) => setParam(jp.name, c)} />
                  </label>
                ) : (
                  <InputField
                    key={jp.name}
                    id={fieldId(`params.${jp.name}`)}
                    label={jp.unit ? `${jp.name} (${jp.unit})` : jp.name}
                    value={String(paramValue(jp.name, jp.default))}
                    onChange={(e) => setParam(jp.name, e.target.value)}
                    hint={`${jp.description}${jp.min !== undefined ? ` ${jp.min}–${jp.max}.` : ""}`}
                    error={errorFor(`params.${jp.name}`)}
                  />
                ),
              )}
            </div>
          </Group>
        ) : null}

        <Group title="Thresholds" description="Both stop the run when crossed (abort on fail). Every run needs them.">
          <div className="grid gap-3 sm:grid-cols-2">
            <InputField id={fieldId("p95Ms")} label="p95 latency (ms)" value={String(input.p95Ms ?? "")} onChange={(e) => set({ p95Ms: e.target.value })} error={errorFor("p95Ms")} />
            <InputField id={fieldId("errorRatePct")} label="Error rate (%)" value={String(input.errorRatePct ?? "")} onChange={(e) => set({ errorRatePct: e.target.value })} error={errorFor("errorRatePct")} />
          </div>
        </Group>

        <Group title="Note">
          <InputField id={fieldId("note")} label={base ? "What changed (optional)" : "Note (optional)"} value={input.note ?? ""} onChange={(e) => set({ note: e.target.value })} error={errorFor("note")} />
        </Group>

        {latest ? (
          <div className="grid gap-2 border-t border-border pt-5" aria-live="polite">
            <span className="text-xs font-semibold">Changes from v{latest.version}</span>
            {changes.length ? (
              <ul className="grid gap-1 text-xs">
                {changes.map((c) => (
                  <li key={c} className="font-mono">{c}</li>
                ))}
              </ul>
            ) : (
              <p className={noChange && submitted ? "text-xs font-medium text-danger" : "text-xs text-muted-foreground"}>Nothing yet. Change something to save a new version.</p>
            )}
          </div>
        ) : null}
      </form>
    </RightPullSheet>
  );
}
