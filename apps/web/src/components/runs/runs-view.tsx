"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, Gauge, Lock, Plus, RotateCw, SearchX, TriangleAlert, X } from "lucide-react";

import { useNow } from "@/lib/use-now";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/arbiter/empty-state";
import { FilterMenu } from "@/components/arbiter/filter-menu";
import { PageBody, PageShell } from "@/components/arbiter/page-shell";
import { LinkPending } from "@/components/arbiter/link-pending";
import { useNavigate } from "@/components/navigation";
import { useProject } from "@/components/project-provider";
import { InProgressBand, InProgressRail } from "./in-progress-band";
import { RunHistory } from "./run-history";
import { RunsError, useRunFilters, useRuns } from "./use-runs";

function CreateRunButton() {
  return (
    <Button asChild size="sm">
      <Link href="/runs/new">
        <LinkPending>
          <Plus />
        </LinkPending>
        Create run
      </Link>
    </Button>
  );
}

/**
 * UI-03 Runs list (the golden reference page). Composition: In progress (focal: a rail beside the
 * content card from xl, a band at the top below xl) → filter bar → history grouped by day → Load more. Every state: loading, empty, no results,
 * error, no access.
 */
export function RunsView({ canCreate }: { canCreate: boolean }) {
  const nav = useNavigate();
  const now = useNow(60_000);
  const { project } = useProject();
  const { filters, activeCount, simulate, created, pending: filterPending, setFilter, clear } = useRunFilters();
  const query = useRuns(project.id, filters, simulate);

  const first = query.data?.pages[0];
  // Offset pages can overlap when a refetch lands while history is changing; a run still renders once.
  const items = [...new Map(query.data?.pages.flatMap((page) => page.items).map((run) => [run.id, run]) ?? []).values()];
  const filtering = activeCount > 0 || !!filters.q;

  // After Create run: bring the new row into view once it's in the list.
  const hasCreated = !!created && items.some((r) => r.id === created);
  React.useEffect(() => {
    if (!hasCreated) return;
    // Desktop table and phone list both render (one hidden by CSS): scroll to the visible row.
    const rows = document.querySelectorAll<HTMLElement>(`[data-run-id="${CSS.escape(created!)}"]`);
    [...rows].find((el) => el.offsetParent)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [hasCreated, created]);

  const header = (
    <PageShell
      title="Runs"
      subtitle={first ? `${project.name} · ${first.total} in history` : project.name}
      searchLabel="Search runs"
      searchDefaultValue={filters.q}
      onSearch={(q) => setFilter("q", q.trim() || undefined)}
      action={canCreate ? <CreateRunButton /> : undefined}
      onAction={canCreate ? () => nav.push("/runs/new") : undefined}
      actionPending={nav.pending}
    />
  );

  if (query.isError && !query.data) {
    const forbidden = query.error instanceof RunsError && query.error.status === 403;
    return (
      <>
        {/* No Create run for a project you can't see. */}
        {forbidden ? <PageShell title="Runs" subtitle={project.name} /> : header}
        <PageBody>
          {forbidden ? (
            <EmptyState
              icon={<Lock />}
              title="You don't have access to these runs"
              description={`Your account can't see runs in ${project.name}. Ask a Benchmark admin for access, or switch project.`}
            />
          ) : (
            <EmptyState
              icon={<TriangleAlert />}
              title="Couldn't load runs"
              description="The run service didn't answer. Your runs are safe; try again in a moment."
              action={<Button size="sm" variant="outline" icon={<RotateCw />} loading={query.isRefetching} onClick={() => query.refetch()}>Try again</Button>}
            />
          )}
        </PageBody>
      </>
    );
  }

  return (
    <>
      {header}
      {/* Same runs, two homes: a band in the page below xl, a rail beside the content card from xl. */}
      <InProgressBand runs={first?.active ?? []} loading={query.isPending} />
      <InProgressRail runs={first?.active ?? []} loading={query.isPending} />

      <PageBody className="grid gap-4">
        {/* Filters: same 32px height as the search and the primary action. */}
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <FilterMenu
            label="Target"
            allLabel="All targets"
            value={filters.target}
            options={(first?.facets.targets ?? []).map((t) => ({ value: t.id, label: t.name }))}
            onChange={(v) => setFilter("target", v)}
          />
          <FilterMenu
            label="Scenario"
            allLabel="All scenarios"
            value={filters.scenario}
            options={(first?.facets.scenarios ?? []).map((s) => ({ value: s, label: s }))}
            onChange={(v) => setFilter("scenario", v)}
          />
          <FilterMenu
            label="Release"
            allLabel="All releases"
            value={filters.release}
            options={(first?.facets.releases ?? []).map((r) => ({ value: r, label: r }))}
            onChange={(v) => setFilter("release", v)}
          />
          <FilterMenu
            label="Result"
            allLabel="Any result"
            value={filters.result}
            options={[{ value: "pass", label: "Pass" }, { value: "fail", label: "Fail" }]}
            onChange={(v) => setFilter("result", v)}
          />
          {filtering ? (
            <Button size="sm" variant="ghost" icon={<X />} onClick={clear}>Clear filters</Button>
          ) : null}
          {filterPending || (query.isFetching && !query.isPending && !query.isFetchingNextPage) ? (
            <span aria-live="polite" className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-3 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
              Updating
            </span>
          ) : null}
        </div>

        {query.isPending ? (
          <div className="grid gap-2" aria-busy="true" aria-label="Loading runs">
            <Skeleton className="h-10" />
            {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14" style={{ opacity: 1 - i * 0.12 }} />)}
          </div>
        ) : items.length === 0 ? (
          filtering ? (
            <EmptyState
              icon={<SearchX />}
              title="No runs match these filters"
              description="Try another target, scenario or release, or clear the filters."
              action={<Button size="sm" variant="outline" icon={<X />} onClick={clear}>Clear filters</Button>}
            />
          ) : (
            <EmptyState
              icon={<Gauge />}
              title={first?.active.length ? "No finished runs yet" : "No runs yet"}
              description={canCreate ? "Create a run to load-test a target with an approved scenario." : "Runs that engineers create in this project will appear here."}
              action={canCreate ? <CreateRunButton /> : undefined}
            />
          )
        ) : (
          <>
            <RunHistory runs={items} now={now} highlightId={created} />
            <div className="flex flex-col items-center gap-2 pt-1">
              {query.hasNextPage ? (
                <Button size="sm" variant="outline" icon={<ChevronDown />} loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
                  Load more
                </Button>
              ) : null}
              <span className="text-xs text-muted-foreground">
                Showing {items.length} of {first?.total ?? items.length}
              </span>
            </div>
          </>
        )}
      </PageBody>
    </>
  );
}
