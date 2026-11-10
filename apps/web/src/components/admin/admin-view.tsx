"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Check, ChevronDown, Crosshair, Database, FolderPlus, History, Info, Pencil, Plus, Trash2, UserPlus } from "lucide-react";

import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/time";
import { useNow } from "@/lib/use-now";
import type { AuditEntry, TestDataPool } from "@/lib/server/admin-data";
import type { Project } from "@/lib/projects";
import type { Target } from "@/lib/runs/catalog";
import type { Ceiling, EnvironmentInfo } from "@/lib/runs/environments";
import { ROLE_LABEL, type Role } from "@/lib/session";
import { Badge } from "@/components/ui/badge";
import { Button, Spinner } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Hint, Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/arbiter/confirm-dialog";
import { EmptyState } from "@/components/arbiter/empty-state";
import { PageBody, PageShell } from "@/components/arbiter/page-shell";
import { RowActions } from "@/components/arbiter/row-actions";
import { Tabs } from "@/components/arbiter/tabs";
import { notify } from "@/components/arbiter/toast";
import { useNavigate } from "@/components/navigation";
import { CeilingSheet, PersonSheet, PoolSheet, ProjectSheet, ROLE_HELP, TargetSheet, adminErrorToast, adminRequest } from "./admin-sheets";
import { roleChangeSchema } from "@btb/contracts/schemas";

type ProjectRow = Project & { targets: number; scenarios: number; runs: number };
type TargetRow = Target & { runs: number };
type EnvRow = EnvironmentInfo & { ceiling: Ceiling };
type Person = { id: string; name: string; email: string; role: Role | null; added: boolean };

const fmt = (n: number) => n.toLocaleString("en-US");
const TABS = ["projects", "targets", "environments", "people", "test-data", "activity"] as const;
type Tab = (typeof TABS)[number];

function SectionHead({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

/** Delete with a confirm dialog; the server may still refuse (history), which ends in a toast. */
function useDelete() {
  const nav = useNavigate();
  const [pending, setPending] = React.useState<{ url: string; title: string; description: string; success: string } | null>(null);
  const del = useMutation({
    mutationFn: (url: string) => adminRequest(url, "DELETE"),
    onSuccess: () => {
      notify.success(pending?.success ?? "Deleted");
      setPending(null);
      nav.refresh();
    },
    onError: (error) => {
      setPending(null);
      adminErrorToast(error, "Couldn't delete");
    },
  });
  const dialog = (
    <ConfirmDialog
      open={!!pending}
      destructive
      title={pending?.title ?? ""}
      description={pending?.description ?? ""}
      confirmLabel="Delete"
      confirmIcon={<Trash2 />}
      loading={del.isPending}
      onCancel={() => setPending(null)}
      onConfirm={() => pending && del.mutate(pending.url)}
    />
  );
  return { ask: setPending, dialog };
}

function RoleMenu({ person, me, adminCount }: { person: Person; me: string; adminCount: number }) {
  const nav = useNavigate();
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  const change = useMutation({
    mutationFn: (role: Role | "none") => adminRequest(`/api/admin/people/${person.id}`, "PATCH", roleChangeSchema.parse({ role })),
    onSuccess: (_d, role) => {
      notify.success(
        `${person.name}'s role changed`,
        role === "none" ? "They can't sign in any more. It applies on their next page load." : `Now ${ROLE_LABEL[role]}. It applies on their next page load.`,
      );
      setConfirmRemove(false);
      nav.refresh();
    },
    onError: (error) => {
      setConfirmRemove(false);
      adminErrorToast(error, "Couldn't change the role");
    },
  });
  const busy = change.isPending || nav.pending;
  const locked = person.id === me ? "You can't change your own role. Ask another admin." : person.role === "admin" && adminCount === 1 ? "The last admin. Make someone else an admin first." : null;
  const label = person.role ? ROLE_LABEL[person.role] : "No access";

  const trigger = (
    <button
      type="button"
      disabled={!!locked || busy}
      aria-label={`Role for ${person.name}: ${label}`}
      className="inline-flex h-8 min-w-32 cursor-pointer items-center justify-between gap-2 rounded-lg border border-border bg-card px-2.5 text-xs font-medium outline-none hover:bg-muted focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-60 data-[state=open]:bg-muted"
    >
      <span className={cn(!person.role && "text-warning")}>{label}</span>
      {busy ? <Spinner className="size-3" /> : <ChevronDown className="size-3.5 text-muted-foreground" />}
    </button>
  );

  if (locked) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex rounded-lg outline-none focus-visible:shadow-focus">
            {trigger}
          </span>
        </TooltipTrigger>
        <TooltipContent>{locked}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel>Role</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={person.role ?? "none"}
            onValueChange={(v) => {
              if (v === (person.role ?? "none")) return;
              if (v === "none") setConfirmRemove(true);
              else change.mutate(v as Role);
            }}
          >
            {(["viewer", "engineer", "approver", "admin"] as Role[]).map((r) => (
              <DropdownMenuRadioItem key={r} value={r}>
                <span className="grid">
                  <span className="font-medium">{ROLE_LABEL[r]}</span>
                  <span className="text-micro text-muted-foreground">{ROLE_HELP[r]}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuRadioItem value="none">
              <span className="grid">
                <span className="font-medium text-danger">No access</span>
                <span className="text-micro text-muted-foreground">Can&apos;t sign in. Their history stays.</span>
              </span>
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirmRemove}
        destructive
        title={`Remove ${person.name}'s access?`}
        description="They won't be able to sign in. Runs and approvals they made stay in the history. You can give access back later."
        confirmLabel="Remove access"
        loading={change.isPending}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => change.mutate("none")}
      />
    </>
  );
}

/** UI-07 Admin: projects, targets (active project), environment ceilings, people and roles, test data, activity. */
export function AdminView({
  me, projectId, projects, targets, environments, people, pools, audit,
}: {
  me: string;
  projectId: string;
  projects: ProjectRow[];
  targets: TargetRow[];
  environments: EnvRow[];
  people: Person[];
  pools: TestDataPool[];
  audit: AuditEntry[];
}) {
  const now = useNow(60_000);
  const sp = useSearchParams();
  const initial = sp.get("tab") as Tab | null;
  const [tab, setTab] = React.useState<Tab>(initial && TABS.includes(initial) ? initial : "projects");
  const [sheet, setSheet] = React.useState<
    { kind: "project"; project?: ProjectRow } | { kind: "target"; target?: TargetRow } | { kind: "ceiling"; env: EnvRow } | { kind: "person" } | { kind: "pool"; pool: TestDataPool } | null
  >(null);
  const close = React.useCallback(() => setSheet(null), []);
  const { ask, dialog } = useDelete();
  const project = projects.find((p) => p.id === projectId);
  const adminCount = people.filter((p) => p.role === "admin").length;

  function changeTab(next: string) {
    setTab(next as Tab);
    const url = new URL(window.location.href);
    if (next === "projects") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  }

  const projectsTab = (
    <div className="grid gap-4">
      <SectionHead
        title="Projects"
        description="A project scopes runs, targets, scenarios and approvals."
        action={<Button size="sm" icon={<FolderPlus />} onClick={() => setSheet({ kind: "project" })}>New project</Button>}
      />
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <Table aria-label="Projects">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Project</TableHead>
              <TableHead className="max-sm:hidden">Targets</TableHead>
              <TableHead className="max-sm:hidden">Scenarios</TableHead>
              <TableHead>Runs</TableHead>
              <TableHead className="w-10"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <div className="leading-tight">
                    <div className="flex items-center gap-2 font-medium">
                      {p.name}
                      {p.id === projectId ? <Badge tone="info">Active</Badge> : null}
                    </div>
                    <div className="text-xs text-muted-foreground">{p.description ?? <span className="font-mono">{p.id}</span>}</div>
                  </div>
                </TableCell>
                <TableCell className="max-sm:hidden">{p.targets}</TableCell>
                <TableCell className="max-sm:hidden">{p.scenarios}</TableCell>
                <TableCell>{fmt(p.runs)}</TableCell>
                <TableCell>
                  <RowActions
                    label={`Actions for ${p.name}`}
                    actions={[
                      { label: "Edit", icon: <Pencil />, onSelect: () => setSheet({ kind: "project", project: p }) },
                      {
                        label: "Delete",
                        icon: <Trash2 />,
                        destructive: true,
                        onSelect: () =>
                          ask({ url: `/api/admin/projects/${p.id}`, title: `Delete ${p.name}?`, description: "Only empty projects can be deleted: no runs, targets or scenarios. This can't be undone.", success: `${p.name} deleted` }),
                      },
                    ]}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );

  const targetsTab = (
    <div className="grid gap-4">
      <SectionHead
        title={`Targets in ${project?.name ?? "this project"}`}
        description="Where runs may send load. Switch project from the menu at the top to manage another project's targets."
        action={<Button size="sm" icon={<Plus />} onClick={() => setSheet({ kind: "target" })}>New target</Button>}
      />
      {targets.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {targets.map((t) => (
            <article key={t.id} className="grid grid-cols-1 content-start gap-3 rounded-lg border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-sm font-semibold">{t.id}</span>
                    <Badge tone={t.environment === "prod-like" ? "warning" : "neutral"}>{t.environment === "prod-like" ? "Prod-like" : "Staging"}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">{t.runs ? `${fmt(t.runs)} runs` : "No runs yet"}</div>
                </div>
                <RowActions
                  label={`Actions for ${t.id}`}
                  actions={[
                    { label: "Edit", icon: <Pencil />, onSelect: () => setSheet({ kind: "target", target: t }) },
                    {
                      label: "Delete",
                      icon: <Trash2 />,
                      destructive: true,
                      onSelect: () => ask({ url: `/api/admin/targets/${t.id}`, title: `Delete ${t.id}?`, description: "Targets that runs have used can't be deleted, so their history stays readable.", success: `${t.id} deleted` }),
                    },
                  ]}
                />
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Hosts</dt>
                  <dd className="font-mono break-all">{t.hosts.join(", ")}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Paths · methods</dt>
                  <dd className="font-mono">
                    {t.paths.join(", ")} · {t.methods.join(" ")}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Redirects</dt>
                  <dd className="font-mono break-all">{t.redirects.length ? t.redirects.join(", ") : "None"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Reference peak</dt>
                  <dd>
                    {fmt(t.referencePeak.vus)} VUs · {fmt(t.referencePeak.rps)} RPS
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Health endpoint</dt>
                  <dd className="font-mono">{t.healthPath}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Integrity source</dt>
                  <dd className={t.integrityPath ? "font-mono break-all" : "text-muted-foreground"}>{t.integrityPath ?? "None: runs aren't checked"}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Crosshair />}
          title={`${project?.name ?? "This project"} has no targets`}
          description="A target is an allowlisted place runs may load, with its reference peak and health endpoint."
          action={<Button size="sm" icon={<Plus />} onClick={() => setSheet({ kind: "target" })}>New target</Button>}
        />
      )}
    </div>
  );

  const environmentsTab = (
    <div className="grid gap-4">
      <SectionHead title="Environments" description="Each is its own Kubernetes namespace and policy. Ceilings are hard limits no preset can exceed." />
      <div className="grid gap-3 lg:grid-cols-2">
        {environments.map((e) => (
          <article key={e.id} className="grid content-start gap-4 rounded-lg border border-border bg-card p-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">{e.label}</h3>
                <div className="font-mono text-xs text-muted-foreground">{e.namespace}</div>
              </div>
              <Button size="sm" variant="outline" icon={<Pencil />} onClick={() => setSheet({ kind: "ceiling", env: e })}>
                Edit ceilings
              </Button>
            </div>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Max VUs", fmt(e.ceiling.vus)],
                ["Max RPS", fmt(e.ceiling.rps)],
                ["Max duration", e.ceiling.durationSec >= 3600 ? `${e.ceiling.durationSec / 3600} h` : `${e.ceiling.durationSec / 60} min`],
                ["Max ramp", `${fmt(e.ceiling.rampPerMin)}/min`],
              ].map(([k, v]) => (
                <div key={k} className="rounded-md bg-muted px-3 py-2">
                  <dt className="text-micro text-muted-foreground">{k}</dt>
                  <dd className="text-sm font-semibold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="grid gap-1 text-xs text-muted-foreground">
              <span>
                <span className="font-medium text-foreground">Approvals:</span> {e.approvals}
              </span>
              <span>{e.note}</span>
            </div>
          </article>
        ))}
      </div>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-px size-3.5 shrink-0" />
        Ceiling values are placeholders until the Engineering manager and DevOps set them (TBD-12). Adding a third environment needs a new namespace from DevOps.
      </p>
    </div>
  );

  const peopleTab = (
    <div className="grid gap-4">
      <SectionHead
        title="People"
        description="Roles live here, not in Microsoft groups. A change applies on the person's next page load."
        action={<Button size="sm" icon={<UserPlus />} onClick={() => setSheet({ kind: "person" })}>Add person</Button>}
      />
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <Table aria-label="People">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Person</TableHead>
              <TableHead>Role</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {people.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <div className="leading-tight">
                    <div className="flex items-center gap-2 font-medium">
                      {p.name}
                      {p.id === me ? <Badge>You</Badge> : null}
                      {p.added ? <Badge tone="info">New</Badge> : null}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{p.email}</div>
                  </div>
                </TableCell>
                <TableCell>
                  <RoleMenu person={p} me={me} adminCount={adminCount} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );

  const testDataTab = (
    <div className="grid gap-4">
      <SectionHead title={`Test data in ${project?.name ?? "this project"}`} description="Test identities per target, split across runner pods so no two pods share one. Credentials come from External Secrets, never from run plans." />
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-px size-3.5 shrink-0" />
        <span>
          Proposal (TBD-6): hooks are HTTP calls to a path on the target&apos;s own host, so they can&apos;t reach anything the allowlist doesn&apos;t. SQL hooks wait on the hook security model.
        </span>
      </p>
      {pools.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {pools.map((pool) => {
            const free = pool.total - pool.inUse;
            if (!pool.configured) {
              return (
                <article key={pool.targetId} className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border bg-card p-4">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-sm font-semibold">{pool.targetId}</div>
                    <div className="text-xs text-muted-foreground">No pool. Runs on it don&apos;t use managed test data.</div>
                  </div>
                  <Button size="sm" variant="outline" icon={<Plus />} onClick={() => setSheet({ kind: "pool", pool })}>
                    Set up
                  </Button>
                </article>
              );
            }
            return (
              <article key={pool.targetId} className="grid grid-cols-1 content-start gap-3 rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-mono text-sm font-semibold">{pool.targetId}</span>
                    {pool.total === 0 ? <Badge tone="danger">Empty</Badge> : <Badge tone="success">Ready</Badge>}
                  </div>
                  <RowActions
                    label={`Actions for ${pool.targetId} test data`}
                    actions={[
                      { label: "Edit", icon: <Pencil />, onSelect: () => setSheet({ kind: "pool", pool }) },
                      {
                        label: "Remove pool",
                        icon: <Trash2 />,
                        destructive: true,
                        onSelect: () =>
                          ask({
                            url: `/api/admin/pools/${pool.targetId}`,
                            title: `Remove ${pool.targetId}'s test data pool?`,
                            description: "Runs on this target stop using managed identities and hooks. The credentials in External Secrets stay.",
                            success: `${pool.targetId} pool removed`,
                          }),
                      },
                    ]}
                  />
                </div>
                <div className="grid gap-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
                    <span>
                      <span className="text-base font-semibold tabular-nums">{fmt(free)}</span> free of {fmt(pool.total)} identities
                    </span>
                    {pool.inUse ? <span className="text-muted-foreground">{fmt(pool.inUse)} in use by a running test</span> : null}
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-success" style={{ width: pool.total ? `${(free / pool.total) * 100}%` : "0%" }} />
                  </div>
                  {pool.total === 0 ? <p className="text-micro font-medium text-danger">Runs on this target fail the “Test-data pool ready” preflight check.</p> : null}
                </div>
                <dl className="grid grid-cols-1 gap-1.5 text-xs">
                  <div className="flex justify-between gap-3">
                    <dt className="shrink-0 text-muted-foreground">Credentials</dt>
                    <Hint label={`External Secrets: ${pool.secretPath}`}>
                      <dd className="min-w-0 truncate font-mono">{pool.secretPath}</dd>
                    </Hint>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="shrink-0 text-muted-foreground">Seed hook</dt>
                    <dd className="min-w-0 truncate font-mono">{pool.seedHook ?? <span className="font-sans text-muted-foreground">None</span>}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="shrink-0 text-muted-foreground">Cleanup hook</dt>
                    <dd className="min-w-0 truncate font-mono">{pool.cleanupHook ?? <span className="font-sans text-muted-foreground">None</span>}</dd>
                  </div>
                </dl>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={<Database />} title="No targets, so no test data" description="Add a target first; its identity pool appears here." />
      )}
    </div>
  );

  const activityTab = (
    <div className="grid gap-4">
      <SectionHead title="Recent admin changes" description="Role changes and edits to projects, targets and ceilings." />
      {audit.length ? (
        <ol className="divide-y divide-border rounded-lg border border-border bg-card">
          {audit.map((a, i) => (
            <li key={`${a.at}-${i}`} className="flex items-start gap-3 px-4 py-3">
              <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
              <div className="min-w-0 flex-1">
                <div className="text-sm">
                  <span className="font-medium">{a.action}</span> <span className="text-muted-foreground">by {a.by}</span>
                </div>
                <div className="text-xs break-words text-muted-foreground">{a.detail}</div>
              </div>
              <time dateTime={a.at} className="text-xs whitespace-nowrap text-muted-foreground">
                {relativeTime(new Date(a.at), now)}
              </time>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState icon={<History />} title="No admin changes yet" description="Changes you make here show up in this list. The permanent record is the append-only audit log, kept for a year." />
      )}
    </div>
  );

  return (
    <>
      <PageShell title="Admin" subtitle="Projects, targets, environments, people and test data" />
      <PageBody>
        <Tabs
          value={tab}
          onChange={changeTab}
          items={[
            { value: "projects", label: "Projects", count: projects.length, content: <div className="pt-4">{projectsTab}</div> },
            { value: "targets", label: "Targets", count: targets.length, content: <div className="pt-4">{targetsTab}</div> },
            { value: "environments", label: "Environments", count: environments.length, content: <div className="pt-4">{environmentsTab}</div> },
            { value: "people", label: "People", count: people.length, content: <div className="pt-4">{peopleTab}</div> },
            { value: "test-data", label: "Test data", content: <div className="pt-4">{testDataTab}</div> },
            { value: "activity", label: "Activity", count: audit.length || undefined, content: <div className="pt-4">{activityTab}</div> },
          ]}
        />
      </PageBody>

      {sheet?.kind === "project" ? <ProjectSheet project={sheet.project} onClose={close} /> : null}
      {sheet?.kind === "target" ? <TargetSheet target={sheet.target} projectName={project?.name ?? ""} onClose={close} /> : null}
      {sheet?.kind === "ceiling" ? <CeilingSheet env={sheet.env} ceiling={sheet.env.ceiling} onClose={close} /> : null}
      {sheet?.kind === "person" ? <PersonSheet onClose={close} /> : null}
      {sheet?.kind === "pool" ? <PoolSheet pool={sheet.pool} host={targets.find((t) => t.id === sheet.pool.targetId)?.hosts[0] ?? ""} onClose={close} /> : null}
      {dialog}
    </>
  );
}
