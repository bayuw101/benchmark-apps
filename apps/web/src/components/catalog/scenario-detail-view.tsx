"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, CopyPlus, Lock, SearchX, TriangleAlert } from "lucide-react";
import { RUNNER_PROTOCOL } from "@btb/contracts";

import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/time";
import { useNow } from "@/lib/use-now";
import type { Journey, ProjectCatalog, Scenario } from "@/lib/runs/catalog";
import { diffVersion, modelLabel } from "@/lib/runs/scenarios";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/arbiter/empty-state";
import { LinkPending } from "@/components/arbiter/link-pending";
import { PageBody, PageShell } from "@/components/arbiter/page-shell";
import { useNavigate } from "@/components/navigation";
import { ScenarioForm } from "./scenario-form";
import { Hint } from "@/components/ui/tooltip";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

function Card({ title, aside, children }: { title: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-5 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-label font-semibold tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  );
}

/** UI-06 scenario detail: one version's definition (immutable) and the version history beside it. */
export function ScenarioDetailView({
  name, scenario, journey, catalog, projectName, canEdit,
}: {
  name: string;
  scenario: Scenario | null;
  journey: Journey | null;
  catalog: ProjectCatalog;
  projectName: string;
  canEdit: boolean;
}) {
  const now = useNow(60_000);
  const nav = useNavigate();
  const [selected, setSelected] = React.useState(scenario?.versions[0]?.version ?? 1);
  const [editing, setEditing] = React.useState(false);
  // After a save: close the sheet once the refreshed page includes the new version.
  const [awaiting, setAwaiting] = React.useState<number | null>(null);
  const latestVersion = scenario?.versions[0]?.version;
  React.useEffect(() => {
    if (awaiting !== null && latestVersion === awaiting) {
      setEditing(false);
      setAwaiting(null);
    }
  }, [awaiting, latestVersion]);

  if (!scenario || !journey) {
    return (
      <>
        <PageShell backHref="/scenarios" backLabel="Back to scenarios" title={name} subtitle={projectName} />
        <PageBody>
          <EmptyState
            icon={<SearchX />}
            title={`${name} isn't in ${projectName}`}
            description="It may belong to another project. Switch project, or pick a scenario from the list."
            action={
              <Button asChild size="sm" variant="outline">
                <Link href="/scenarios">
                  <LinkPending>
                    <ArrowLeft />
                  </LinkPending>
                  Back to scenarios
                </Link>
              </Button>
            }
          />
        </PageBody>
      </>
    );
  }

  const latest = scenario.versions[0];
  const index = Math.max(0, scenario.versions.findIndex((v) => v.version === selected));
  const v = scenario.versions[index];
  const previous = scenario.versions[index + 1];
  const changes = diffVersion(previous, v);

  return (
    <>
      <PageShell
        backHref="/scenarios"
        backLabel="Back to scenarios"
        title={scenario.name}
        titleAside={<Badge>v{latest.version}</Badge>}
        subtitle={`${journey.title} · ${projectName}`}
        actions={
          canEdit ? (
            <Button size="sm" icon={<CopyPlus />} aria-label="New version" onClick={() => setEditing(true)} className="max-sm:w-8 max-sm:px-0">
              <span className="max-sm:sr-only">New version</span>
            </Button>
          ) : null
        }
      />
      <PageBody className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid min-w-0 grid-cols-1 gap-5">
          <Card
            title={
              <span className="flex items-center gap-2">
                Version {v.version}
                {v.version === latest.version ? <Badge tone="success">Latest</Badge> : <Badge>Older</Badge>}
              </span>
            }
            aside={
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Lock className="size-3" />
                Read-only
              </span>
            }
          >
            <div className="grid grid-cols-1 gap-5">
              <p className="text-xs text-muted-foreground">
                Saved by {v.createdBy} <Hint label={when(v.createdAt)}><span>{relativeTime(new Date(v.createdAt), now)}</span></Hint>
                {v.note ? <> · “{v.note}”</> : null}
              </p>

              {!v.thresholds ? (
                <p role="status" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
                  <TriangleAlert className="mt-px size-3.5 shrink-0" />
                  No thresholds. Policy rejects runs with this version; use v{latest.version} or save a new version with thresholds.
                </p>
              ) : null}
              {v.runnerProtocol < RUNNER_PROTOCOL ? (
                <p role="status" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
                  <TriangleAlert className="mt-px size-3.5 shrink-0" />
                  Runner image {v.imageVersion} can&apos;t check its own manifest before load. Policy rejects runs with this version; save a new version to move it to the current image.
                </p>
              ) : null}

              <dl className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4">
                <Fact label="Journey">
                  <span className="font-mono text-xs">
                    {journey.id} {journey.version}
                  </span>
                </Fact>
                <Fact label="Runner image">
                  <span className="font-mono text-xs">{v.imageVersion}</span>
                </Fact>
                <Fact label="Load model">
                  <span className="block first-letter:uppercase">{modelLabel(v.model)}</span>
                </Fact>
                <Fact label="Network">{v.browser ? "Chosen per run" : "Protocol only"}</Fact>
              </dl>

              <div className="grid gap-2">
                <h3 className="text-xs font-semibold">Parameters</h3>
                <dl className="divide-y divide-border rounded-md border border-border text-sm">
                  {journey.params.map((jp) => {
                    const value = v.params[jp.name] ?? jp.default;
                    const changed = previous && previous.params[jp.name] !== v.params[jp.name];
                    return (
                      <div key={jp.name} className={cn("flex items-center justify-between gap-3 px-3 py-2", changed && "bg-info-soft")}>
                        <dt className="min-w-0">
                          <span className="font-mono text-xs">{jp.name}</span>
                          <span className="block text-micro text-muted-foreground">{jp.description}</span>
                        </dt>
                        <dd className="shrink-0 text-right">
                          <span className="font-mono text-xs">
                            {typeof value === "boolean" ? (value ? "on" : "off") : String(value)}
                            {jp.unit && typeof value === "number" ? ` ${jp.unit}` : ""}
                          </span>
                          {value === jp.default ? <span className="block text-micro text-muted-foreground">default</span> : null}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </div>

              <div className="grid gap-2">
                <h3 className="text-xs font-semibold">Thresholds</h3>
                {v.thresholds ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      { label: "p95 latency", value: `≤ ${v.thresholds.p95Ms} ms` },
                      { label: "Error rate", value: `≤ ${v.thresholds.errorRatePct}%` },
                    ].map((t) => (
                      <div key={t.label} className="rounded-md border border-border px-3 py-2">
                        <div className="text-xs text-muted-foreground">{t.label}</div>
                        <div className="text-sm font-semibold">{t.value}</div>
                        <div className="text-micro text-muted-foreground">Stops the run when crossed</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">None.</p>
                )}
              </div>

              <div className="grid gap-2 border-t border-border pt-4">
                <h3 className="text-xs font-semibold">{previous ? `Changes from v${previous.version}` : "First version"}</h3>
                {previous ? (
                  changes.length ? (
                    <ul className="grid gap-1 text-xs">
                      {changes.map((c) => (
                        <li key={c} className="font-mono">{c}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">Same settings, saved again.</p>
                  )
                ) : (
                  <p className="text-xs text-muted-foreground">Created from the {journey.id} journey.</p>
                )}
              </div>
            </div>
          </Card>
        </div>

        <Card title="Versions" aside={<span className="text-xs text-muted-foreground">{scenario.versions.length}</span>}>
          <ol className="-mx-2 grid gap-1">
            {scenario.versions.map((x) => (
              <li key={x.version}>
                <button
                  type="button"
                  aria-current={x.version === v.version ? "true" : undefined}
                  onClick={() => setSelected(x.version)}
                  className="grid w-full cursor-pointer gap-0.5 rounded-md px-2 py-2 text-left outline-none hover:bg-muted focus-visible:shadow-focus aria-[current=true]:bg-muted"
                >
                  <span className="flex items-center justify-between gap-2 text-sm font-medium">
                    v{x.version}
                    {x.version === latest.version ? <Badge tone="success">Latest</Badge> : null}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {relativeTime(new Date(x.createdAt), now)} · {x.createdBy}
                  </span>
                  {x.note ? <span className="truncate text-xs text-muted-foreground">{x.note}</span> : null}
                </button>
              </li>
            ))}
          </ol>
          <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
            Versions never change. Each run records the version and runner image it used.
          </p>
        </Card>
      </PageBody>

      {editing ? (
        <ScenarioForm
          catalog={catalog}
          projectName={projectName}
          base={scenario}
          saving={nav.pending}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setSelected(saved.version);
            setAwaiting(saved.version);
            nav.refresh();
          }}
        />
      ) : null}
    </>
  );
}
