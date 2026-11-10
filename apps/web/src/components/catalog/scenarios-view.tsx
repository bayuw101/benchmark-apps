"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Info, Layers, Plus, SearchX, TriangleAlert } from "lucide-react";
import { RUNNER_PROTOCOL } from "@btb/contracts";

import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/time";
import { useNow } from "@/lib/use-now";
import type { Journey, ProjectCatalog, RunnerImage, Scenario } from "@/lib/runs/catalog";
import { modelLabel } from "@/lib/runs/scenarios";
import { Badge } from "@/components/ui/badge";
import { Button, Spinner } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/arbiter/empty-state";
import { PageBody, PageShell } from "@/components/arbiter/page-shell";
import { Tabs } from "@/components/arbiter/tabs";
import { useNavigate } from "@/components/navigation";
import { ScenarioForm } from "./scenario-form";

const scenarioHref = (s: Scenario) => `/scenarios/${encodeURIComponent(s.name)}`;
const thresholdText = (s: Scenario) => {
  const t = s.versions[0]?.thresholds;
  return t ? `p95 ≤ ${t.p95Ms} ms · errors ≤ ${t.errorRatePct}%` : null;
};

function ScenarioList({ scenarios, journeys, now }: { scenarios: Scenario[]; journeys: Journey[]; now: Date }) {
  const nav = useNavigate();
  const [opening, setOpening] = React.useState<string | null>(null);
  const open = (s: Scenario) => {
    setOpening(s.name);
    nav.push(scenarioHref(s));
  };
  const openFromLink = (e: React.MouseEvent, s: Scenario) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    open(s);
  };
  const isOpening = (s: Scenario) => nav.pending && opening === s.name;
  const openingLabel = (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap text-info">
      <Spinner className="size-3.5" />
      Opening…
    </span>
  );
  const journeyOf = (s: Scenario) => journeys.find((j) => j.id === s.journey);

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-border bg-card max-md:hidden">
        <Table aria-label="Scenarios">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Scenario</TableHead>
              <TableHead>Load model</TableHead>
              <TableHead>Thresholds</TableHead>
              <TableHead>Latest version</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {scenarios.map((s) => {
              const v = s.versions[0];
              const j = journeyOf(s);
              return (
                <TableRow
                  key={s.name}
                  aria-busy={isOpening(s) || undefined}
                  onClick={(e) => {
                    if (!(e.target as HTMLElement).closest("a,button")) open(s);
                  }}
                  className={cn("cursor-pointer", isOpening(s) && "bg-info-soft hover:bg-info-soft [&>td:not(:last-child)]:opacity-50")}
                >
                  <TableCell>
                    <Link href={scenarioHref(s)} onClick={(e) => openFromLink(e, s)} className="grid rounded leading-tight no-underline outline-none focus-visible:shadow-focus">
                      <span className="font-medium text-foreground">{s.name}</span>
                      <span className="text-xs text-muted-foreground">
                        <span className="font-mono">{s.journey}</span>
                        {j?.browser ? " · browser steps" : ""}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="first-letter:uppercase">{v ? modelLabel(v.model) : "—"}</TableCell>
                  <TableCell>
                    {thresholdText(s) ?? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-danger">
                        <TriangleAlert className="size-3.5" />
                        None, can&apos;t run
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {isOpening(s) ? (
                      openingLabel
                    ) : v ? (
                      <div className="leading-tight">
                        <div className="text-sm">
                          v{v.version} <span className="text-muted-foreground">· {relativeTime(new Date(v.createdAt), now)}</span>
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          by {v.createdBy} · image {v.imageVersion}
                          {v.runnerProtocol < RUNNER_PROTOCOL ? <span className="text-danger"> · outdated, save a new version</span> : null}
                        </div>
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card md:hidden">
        {scenarios.map((s) => {
          const v = s.versions[0];
          return (
            <li key={s.name} aria-busy={isOpening(s) || undefined} className={cn(isOpening(s) && "bg-info-soft")}>
              <Link
                href={scenarioHref(s)}
                onClick={(e) => openFromLink(e, s)}
                className={cn("grid gap-1 px-4 py-3 text-foreground no-underline outline-none focus-visible:bg-muted active:bg-muted", isOpening(s) && "[&>div:not(:last-child)]:opacity-50")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{s.name}</span>
                  {v ? <Badge>v{v.version}</Badge> : null}
                </div>
                <div className="text-xs text-muted-foreground">
                  <span className="font-mono">{s.journey}</span> · {v ? modelLabel(v.model) : ""}
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className={thresholdText(s) ? "text-muted-foreground" : "font-medium text-danger"}>{thresholdText(s) ?? "No thresholds, can't run"}</span>
                  {isOpening(s) ? openingLabel : v ? <span className="text-muted-foreground">{relativeTime(new Date(v.createdAt), now)}</span> : null}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function JourneyCatalog({ journeys, scenarios, image, now }: { journeys: Journey[]; scenarios: Scenario[]; image: RunnerImage | null; now: Date }) {
  return (
    <div className="grid gap-4">
      <p className="flex items-start gap-2 rounded-lg border border-border bg-muted px-3.5 py-2.5 text-xs text-muted-foreground">
        <Info className="mt-px size-3.5 shrink-0" />
        <span>
          {image ? (
            <>
              Synced from the runner image{" "}
              <span className="font-mono font-medium text-foreground">
                {image.name}:{image.tag}
              </span>{" "}
              {relativeTime(new Date(image.syncedAt), now)}.
            </>
          ) : (
            "No runner image has been synced yet."
          )}{" "}
          Journeys are code: they change through pull requests, not here.
        </span>
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {journeys.map((j) => {
          const used = scenarios.filter((s) => s.journey === j.id).length;
          return (
            <article key={j.id} aria-labelledby={`journey-${j.id}`} className="grid content-start gap-4 rounded-lg border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 id={`journey-${j.id}`} className="text-sm font-semibold">
                    {j.title}
                  </h3>
                  <div className="font-mono text-xs text-muted-foreground">
                    {j.id} {j.version}
                  </div>
                </div>
                <Badge tone={j.browser ? "info" : "neutral"}>{j.browser ? "Browser" : "Protocol"}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{j.description}</p>

              <div className="grid gap-1.5">
                <span className="text-label font-semibold tracking-wide text-muted-foreground uppercase">Steps</span>
                <ol className="flex flex-wrap items-center gap-1 text-xs">
                  {j.steps.map((step, i) => (
                    <li key={step} className="flex items-center gap-1">
                      {i ? <ArrowRight aria-hidden className="size-3 text-muted-foreground" /> : null}
                      <span className="rounded-md bg-muted px-1.5 py-0.5">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="grid gap-1.5">
                <span className="text-label font-semibold tracking-wide text-muted-foreground uppercase">Parameters</span>
                <dl className="divide-y divide-border rounded-md border border-border text-xs">
                  {j.params.map((jp) => (
                    <div key={jp.name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-3 py-2">
                      <dt className="font-mono">{jp.name}</dt>
                      <dd className="text-right text-muted-foreground">
                        {jp.type} · default <span className="font-mono text-foreground">{String(jp.default)}</span>
                        {jp.min !== undefined ? ` · ${jp.min}–${jp.max}${jp.unit ? ` ${jp.unit}` : ""}` : ""}
                      </dd>
                      <dd className="col-span-2 text-muted-foreground">{jp.description}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {j.budgets.map((b) => (
                    <Badge key={b.metric}>
                      {b.metric} {b.budget}
                    </Badge>
                  ))}
                </div>
                <span className="text-xs text-muted-foreground">{used ? `${used} ${used === 1 ? "scenario" : "scenarios"} here` : "Not used here yet"}</span>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

/** UI-06 Catalog: the project's scenarios (versioned) and the read-only journey catalog. */
export function ScenariosView({
  catalog, journeys, image, projectName, canEdit,
}: {
  catalog: ProjectCatalog;
  journeys: Journey[];
  image: RunnerImage | null;
  projectName: string;
  canEdit: boolean;
}) {
  const now = useNow(60_000);
  const nav = useNavigate();
  const sp = useSearchParams();
  const [tab, setTab] = React.useState(sp.get("tab") === "journeys" ? "journeys" : "scenarios");
  const [q, setQ] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  const needle = q.trim().toLowerCase();
  const scenarios = catalog.scenarios.filter((s) => !needle || `${s.name} ${s.journey}`.toLowerCase().includes(needle));
  const shownJourneys = journeys.filter((j) => !needle || `${j.id} ${j.title} ${j.description}`.toLowerCase().includes(needle));

  function changeTab(next: string) {
    setTab(next);
    // Remember the tab in the URL without a navigation (shareable, Back-friendly enough for a tab).
    const url = new URL(window.location.href);
    if (next === "journeys") url.searchParams.set("tab", "journeys");
    else url.searchParams.delete("tab");
    window.history.replaceState(null, "", url);
  }

  const newButton = canEdit ? (
    <Button size="sm" icon={<Plus />} onClick={() => setCreating(true)} aria-label="New scenario" className="max-sm:w-8 max-sm:px-0">
      <span className="max-sm:sr-only">New scenario</span>
    </Button>
  ) : null;

  const noResults = (
    <EmptyState icon={<SearchX />} title={`Nothing matches “${q.trim()}”`} description="Try a scenario name or a journey such as checkout." />
  );

  return (
    <>
      <PageShell
        title="Scenarios"
        subtitle={`${projectName} · ${catalog.scenarios.length} ${catalog.scenarios.length === 1 ? "scenario" : "scenarios"}`}
        searchLabel={tab === "journeys" ? "Search journeys" : "Search scenarios"}
        onSearch={setQ}
        actions={newButton}
      />
      <PageBody>
        <Tabs
          value={tab}
          onChange={changeTab}
          items={[
            {
              value: "scenarios",
              label: "Scenarios",
              count: catalog.scenarios.length,
              content: (
                <div className="pt-4">
                  {!catalog.scenarios.length ? (
                    <EmptyState
                      icon={<Layers />}
                      title="No scenarios yet"
                      description="A scenario is a journey from the catalog plus parameters, a load model and thresholds. Runs pick one."
                      action={canEdit ? <Button size="sm" icon={<Plus />} onClick={() => setCreating(true)}>New scenario</Button> : undefined}
                    />
                  ) : scenarios.length ? (
                    <ScenarioList scenarios={scenarios} journeys={journeys} now={now} />
                  ) : (
                    noResults
                  )}
                </div>
              ),
            },
            {
              value: "journeys",
              label: "Journeys",
              count: journeys.length,
              content: <div className="pt-4">{shownJourneys.length ? <JourneyCatalog journeys={shownJourneys} scenarios={catalog.scenarios} image={image} now={now} /> : noResults}</div>,
            },
          ]}
        />
      </PageBody>

      {creating ? (
        <ScenarioForm
          catalog={catalog}
          projectName={projectName}
          onClose={() => setCreating(false)}
          saving={nav.pending}
          onSaved={(saved) => nav.push(`/scenarios/${encodeURIComponent(saved.scenario)}`)}
        />
      ) : null}
    </>
  );
}
