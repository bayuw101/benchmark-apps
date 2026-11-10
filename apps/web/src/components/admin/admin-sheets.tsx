"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Plus } from "lucide-react";

import { HTTP_METHODS, type HttpMethod, type Target } from "@/lib/runs/catalog";
import { HOOK_METHODS } from "@/lib/admin/validate";
import type { TestDataPool } from "@/lib/server/admin-data";
import type { Ceiling, EnvironmentInfo } from "@/lib/runs/environments";
import type { PolicyViolation } from "@/lib/runs/types";
import { ROLE_LABEL, type Role } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { InputField } from "@/components/arbiter/input-field";
import { RightPullSheet, SheetCancel } from "@/components/arbiter/right-pull-sheet";
import { SelectField } from "@/components/arbiter/select-field";
import { TextareaField } from "@/components/arbiter/textarea-field";
import { notify } from "@/components/arbiter/toast";
import { useNavigate } from "@/components/navigation";
import { TEST_DATA_KEY, testDataSecretName } from "@btb/contracts";
import {
  ceilingInputSchema,
  parseWith,
  personInputSchema,
  poolInputSchema,
  projectInputSchema,
  targetInputSchema,
  type ZodType,
} from "@btb/contracts/schemas";

export class AdminError extends Error {
  constructor(readonly status: number, readonly body: { reason?: string; violations?: PolicyViolation[] } = {}) {
    super(`admin request failed: ${status}`);
  }
}

export async function adminRequest(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new AdminError(res.status, json);
  return json;
}

export function adminErrorToast(error: unknown, fallback: string) {
  if (error instanceof AdminError && error.status === 409) notify.error(fallback, error.body.reason);
  else if (error instanceof AdminError && error.status === 403) notify.error("Only admins can do this", "Your role may have changed. Reload the page.");
  else notify.error(fallback, "The service didn't answer. Try again.");
}

/**
 * Save → toast → refresh the page's server data → `onDone` once the refreshed data is on screen. Until then the
 * button keeps spinning (instant-feedback rule). The body is parsed with the route's zod schema first (the API
 * parses with the same one); those problems and the server's 422 land on their fields.
 */
export function useAdminSave(onDone: () => void) {
  const nav = useNavigate();
  const [violations, setViolations] = React.useState<PolicyViolation[]>([]);
  const [refreshing, setRefreshing] = React.useState(false);
  const fixFields = (vs: PolicyViolation[]) => {
    setViolations(vs);
    notify.error("Couldn't save", "Fix the marked fields and try again.");
  };
  const save = useMutation({
    mutationFn: (v: { url: string; method: string; body: unknown; success: string; detail?: string }) => adminRequest(v.url, v.method, v.body),
    onSuccess: (_data, v) => {
      notify.success(v.success, v.detail);
      setRefreshing(true);
      nav.refresh();
    },
    onError: (error) => {
      if (error instanceof AdminError && error.status === 422) fixFields(error.body.violations ?? []);
      else adminErrorToast(error, "Couldn't save");
    },
  });
  React.useEffect(() => {
    if (refreshing && !nav.pending) {
      setRefreshing(false);
      onDone();
    }
  }, [refreshing, nav.pending, onDone]);
  return {
    save: ({ schema, ...v }: { url: string; method: string; body: unknown; schema: ZodType; success: string; detail?: string }) => {
      const parsed = parseWith(schema, v.body);
      if (parsed.ok) save.mutate({ ...v, body: parsed.data });
      else fixFields(parsed.violations);
    },
    saving: save.isPending || refreshing,
    errorFor: (field: string) => violations.filter((v) => v.field === field).map((v) => v.message).join(" ") || undefined,
    clear: (field: string) => setViolations((vs) => vs.filter((v) => v.field !== field)),
  };
}

function Sheet({
  title, subtitle, formId, saving, saveLabel, isNew, onClose, children,
}: {
  title: string;
  subtitle?: string;
  formId: string;
  saving: boolean;
  saveLabel: string;
  isNew?: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <RightPullSheet
      open
      wide
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:justify-end">
          <SheetCancel />
          <Button type="submit" form={formId} icon={isNew ? <Plus /> : <Check />} loading={saving}>
            {saveLabel}
          </Button>
        </div>
      }
    >
      {children}
    </RightPullSheet>
  );
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

/* ---------- Project ---------- */

export function ProjectSheet({ project, onClose }: { project?: { id: string; name: string; description?: string }; onClose: () => void }) {
  const [name, setName] = React.useState(project?.name ?? "");
  const [description, setDescription] = React.useState(project?.description ?? "");
  const { save, saving, errorFor, clear } = useAdminSave(onClose);
  return (
    <Sheet title={project ? `Edit ${project.name}` : "New project"} formId="project-form" saving={saving} saveLabel={project ? "Save changes" : "Create project"} isNew={!project} onClose={onClose}>
      <form
        id="project-form"
        noValidate
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save(
            project
              ? { url: `/api/admin/projects/${project.id}`, method: "PATCH", body: { name, description }, schema: projectInputSchema, success: `${name.trim()} saved` }
              : { url: "/api/admin/projects", method: "POST", body: { name, description }, schema: projectInputSchema, success: `${name.trim()} created`, detail: "Add its targets next. Switch to it from the project menu." },
          );
        }}
      >
        <InputField label="Name" value={name} onChange={(e) => (setName(e.target.value), clear("name"))} error={errorFor("name")} />
        <InputField label="Description (optional)" value={description} onChange={(e) => (setDescription(e.target.value), clear("description"))} hint="Shown under the name in the project menu." error={errorFor("description")} />
      </form>
    </Sheet>
  );
}

/* ---------- Target ---------- */

export function TargetSheet({ target, projectName, onClose }: { target?: Target; projectName: string; onClose: () => void }) {
  const [form, setForm] = React.useState(() => ({
    id: target?.id ?? "",
    environment: target?.environment ?? "staging",
    hosts: target?.hosts.join("\n") ?? "",
    paths: target?.paths.join("\n") ?? "/",
    methods: target?.methods ?? (["GET", "POST"] as HttpMethod[]),
    redirects: target?.redirects.join("\n") ?? "",
    peakVus: target ? String(target.referencePeak.vus) : "",
    peakRps: target ? String(target.referencePeak.rps) : "",
    healthPath: target?.healthPath ?? "/health",
    integrityPath: target?.integrityPath ?? "",
  }));
  const { save, saving, errorFor, clear } = useAdminSave(onClose);
  const set = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
    Object.keys(patch).forEach(clear);
  };
  const toggleMethod = (m: HttpMethod, on: boolean) => set({ methods: on ? [...form.methods, m] : form.methods.filter((x) => x !== m) });

  return (
    <Sheet
      title={target ? `Edit ${target.id}` : "New target"}
      subtitle={projectName}
      formId="target-form"
      saving={saving}
      saveLabel={target ? "Save changes" : "Create target"}
      isNew={!target}
      onClose={onClose}
    >
      <form
        id="target-form"
        noValidate
        className="grid gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          save(
            target
              ? { url: `/api/admin/targets/${target.id}`, method: "PATCH", body: form, schema: targetInputSchema, success: `${target.id} saved`, detail: "New runs use the new allowlist and peak." }
              : { url: "/api/admin/targets", method: "POST", body: form, schema: targetInputSchema, success: `${form.id.trim()} created`, detail: "It's ready to pick in Create run." },
          );
        }}
      >
        <Group title="Target" description={target ? "The name can't change: runs and manifests refer to it." : "Runs refer to this name, so it can't change later."}>
          <div className="grid gap-3 sm:grid-cols-2">
            {target ? (
              <div className="flex min-h-11 items-center rounded-lg border border-border bg-muted px-3 font-mono text-sm">{target.id}</div>
            ) : (
              <InputField label="Name" value={form.id} onChange={(e) => set({ id: e.target.value })} hint="e.g. tickets-staging" error={errorFor("id")} />
            )}
            <SelectField
              label="Environment"
              value={form.environment}
              onChange={(v) => set({ environment: v as Target["environment"] })}
              options={[
                { value: "staging", label: "Staging", description: "perf-staging namespace" },
                { value: "prod-like", label: "Prod-like", description: "perf-prod namespace · 2 approvers per run" },
              ]}
              error={errorFor("environment")}
            />
          </div>
        </Group>

        <Group title="Allowlist" description="Runs can only reach these. Anything else is rejected by policy and blocked by the network layer.">
          <TextareaField label="Hostnames, one per line" rows={3} value={form.hosts} onChange={(e) => set({ hosts: e.target.value })} hint="Exact names, no wildcards: tickets.staging.example.com" error={errorFor("hosts")} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextareaField label="Paths, one per line" rows={3} value={form.paths} onChange={(e) => set({ paths: e.target.value })} hint="Prefixes, e.g. /api. Default: / (everything)." error={errorFor("paths")} />
            <TextareaField label="Redirect destinations (optional)" rows={3} value={form.redirects} onChange={(e) => set({ redirects: e.target.value })} hint="Hostnames a response may redirect to, e.g. a payment page." error={errorFor("redirects")} />
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-xs font-medium text-muted-foreground">Methods</legend>
            <div className="flex flex-wrap gap-2">
              {HTTP_METHODS.map((m) => (
                <label key={m} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 font-mono text-xs has-[[data-state=checked]]:border-foreground">
                  <Checkbox checked={form.methods.includes(m)} onCheckedChange={(c) => toggleMethod(m, c === true)} />
                  {m}
                </label>
              ))}
            </div>
            {errorFor("methods") ? <p className="text-micro font-medium text-danger">{errorFor("methods")}</p> : null}
          </fieldset>
        </Group>

        <Group title="Load and health" description="Presets size load from the reference peak. The health endpoint is probed every 10 s during a run; 3 failures abort it.">
          <div className="grid gap-3 sm:grid-cols-3">
            <InputField label="Reference peak (VUs)" value={form.peakVus} onChange={(e) => set({ peakVus: e.target.value })} error={errorFor("peakVus")} />
            <InputField label="Reference peak (RPS)" value={form.peakRps} onChange={(e) => set({ peakRps: e.target.value })} error={errorFor("peakRps")} />
            <InputField label="Health endpoint" value={form.healthPath} onChange={(e) => set({ healthPath: e.target.value })} error={errorFor("healthPath")} />
          </div>
        </Group>

        <Group title="Integrity" description="A read-only endpoint the worker reads after each run, with the run window as since/until. It answers oversold, doubleCharges and chargedNoTicket; any non-zero count fails the run.">
          <InputField
            label="Integrity endpoint (optional)"
            value={form.integrityPath}
            onChange={(e) => set({ integrityPath: e.target.value })}
            error={errorFor("integrityPath")}
            hint="Empty: runs on this target carry the caveat “integrity not verified”."
          />
        </Group>
      </form>
    </Sheet>
  );
}

/* ---------- Environment ceilings ---------- */

export function CeilingSheet({ env, ceiling, onClose }: { env: EnvironmentInfo; ceiling: Ceiling; onClose: () => void }) {
  const [form, setForm] = React.useState({ vus: String(ceiling.vus), rps: String(ceiling.rps), durationMin: String(ceiling.durationSec / 60), rampPerMin: String(ceiling.rampPerMin) });
  const { save, saving, errorFor, clear } = useAdminSave(onClose);
  const set = (k: keyof typeof form, value: string) => {
    setForm((f) => ({ ...f, [k]: value }));
    clear(k);
  };
  return (
    <Sheet title={`${env.label} ceilings`} subtitle={env.namespace} formId="ceiling-form" saving={saving} saveLabel="Save ceilings" onClose={onClose}>
      <form
        id="ceiling-form"
        noValidate
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save({ url: `/api/admin/environments/${env.id}`, method: "PATCH", body: form, schema: ceilingInputSchema, success: `${env.label} ceilings saved`, detail: "New runs, and Start on existing ones, are checked against them." });
        }}
      >
        <p className="text-xs text-muted-foreground">Absolute limits that no preset can exceed. Runs over them are rejected when created and again at Start.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <InputField label="Max virtual users" value={form.vus} onChange={(e) => set("vus", e.target.value)} error={errorFor("vus")} />
          <InputField label="Max requests per second" value={form.rps} onChange={(e) => set("rps", e.target.value)} error={errorFor("rps")} />
          <InputField label="Max duration (minutes)" value={form.durationMin} onChange={(e) => set("durationMin", e.target.value)} error={errorFor("durationMin")} />
          <InputField label="Max ramp (load added per minute)" value={form.rampPerMin} onChange={(e) => set("rampPerMin", e.target.value)} error={errorFor("rampPerMin")} />
        </div>
      </form>
    </Sheet>
  );
}

/* ---------- Test-data pool ---------- */

export function PoolSheet({ pool, host, onClose }: { pool: TestDataPool; host: string; onClose: () => void }) {
  const [form, setForm] = React.useState({
    total: pool.configured ? String(pool.total) : "",
    secretPath: pool.secretPath,
    seedMethod: pool.seed?.method ?? "POST",
    seedPath: pool.seed?.path ?? "",
    cleanupMethod: pool.cleanup?.method ?? "POST",
    cleanupPath: pool.cleanup?.path ?? "",
  });
  const { save, saving, errorFor, clear } = useAdminSave(onClose);
  const set = (k: keyof typeof form, value: string) => {
    setForm((f) => ({ ...f, [k]: value }));
    clear(k);
  };
  const methodOptions = HOOK_METHODS.map((m) => ({ value: m, label: m }));
  const hookRow = (prefix: "seed" | "cleanup", label: string, hint: string) => (
    <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
      <SelectField label="Method" value={form[`${prefix}Method`]} onChange={(v) => set(`${prefix}Method`, v)} options={methodOptions} error={errorFor(`${prefix}Method`)} />
      <InputField label={label} value={form[`${prefix}Path`]} onChange={(e) => set(`${prefix}Path`, e.target.value)} hint={hint} error={errorFor(`${prefix}Path`)} />
    </div>
  );
  return (
    <Sheet
      title={pool.configured ? `Test data for ${pool.targetId}` : `Set up test data for ${pool.targetId}`}
      formId="pool-form"
      saving={saving}
      saveLabel={pool.configured ? "Save changes" : "Set up pool"}
      isNew={!pool.configured}
      onClose={onClose}
    >
      <form
        id="pool-form"
        noValidate
        className="grid gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          save({ url: `/api/admin/pools/${pool.targetId}`, method: "PUT", body: form, schema: poolInputSchema, success: `${pool.targetId} test data saved`, detail: "New runs use it." });
        }}
      >
        <Group title="Identities" description="Split across runner pods at start so no two pods share one. Runs fail preflight while the pool is empty.">
          <div className="grid gap-3 sm:grid-cols-2">
            <InputField label="Identities in the pool" value={form.total} onChange={(e) => set("total", e.target.value)} error={errorFor("total")} />
            <InputField label="External Secrets path" value={form.secretPath} onChange={(e) => set("secretPath", e.target.value)} hint={`Only the path is stored. External Secrets syncs it into the Secret ${testDataSecretName(pool.targetId)} (key ${TEST_DATA_KEY}, a JSON array) in each runner namespace; runner pods mount it read-only.`} error={errorFor("secretPath")} />
          </div>
        </Group>
        <Group title="Hooks (optional)" description={`HTTP calls to ${host}. Seed runs after the other preflight checks pass; if it fails, the run doesn't start. Cleanup runs after every run.`}>
          {hookRow("seed", "Seed path", "e.g. /__admin/reset. Leave empty for none.")}
          {hookRow("cleanup", "Cleanup path", "Leave empty for none.")}
        </Group>
      </form>
    </Sheet>
  );
}

/* ---------- Person ---------- */

export const ROLE_HELP: Record<Role, string> = {
  viewer: "Can read runs, results and the catalog",
  engineer: "Can also create, edit and start runs, and save scenarios",
  approver: "Can also approve runs they didn't start",
  admin: "Can also manage projects, targets, environments and people",
};

export function PersonSheet({ onClose }: { onClose: () => void }) {
  const [form, setForm] = React.useState({ name: "", email: "", role: "engineer" });
  const { save, saving, errorFor, clear } = useAdminSave(onClose);
  const set = (k: keyof typeof form, value: string) => {
    setForm((f) => ({ ...f, [k]: value }));
    clear(k);
  };
  return (
    <Sheet title="Add person" formId="person-form" saving={saving} saveLabel="Add person" isNew onClose={onClose}>
      <form
        id="person-form"
        noValidate
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save({ url: "/api/admin/people", method: "POST", body: form, schema: personInputSchema, success: `${form.name.trim()} added`, detail: "They can sign in with Microsoft now." });
        }}
      >
        <p className="text-xs text-muted-foreground">People sign in with their Microsoft work account. Only people with a role here get in.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <InputField label="Name" value={form.name} onChange={(e) => set("name", e.target.value)} error={errorFor("name")} />
          <InputField label="Work email" value={form.email} onChange={(e) => set("email", e.target.value)} autoComplete="off" error={errorFor("email")} />
        </div>
        <SelectField
          label="Role"
          value={form.role}
          onChange={(v) => set("role", v)}
          options={(["viewer", "engineer", "approver", "admin"] as Role[]).map((r) => ({ value: r, label: ROLE_LABEL[r], description: ROLE_HELP[r] }))}
          error={errorFor("role")}
        />
      </form>
    </Sheet>
  );
}
