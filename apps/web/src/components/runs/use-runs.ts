"use client";

import { useSearchParams } from "next/navigation";

import { useNavigate } from "@/components/navigation";
import { useInfiniteQuery } from "@tanstack/react-query";

import type { RunFilters, RunPage } from "@/lib/runs/types";

export class RunsError extends Error {
  constructor(public status: number) {
    super(`GET /api/runs failed with ${status}`);
  }
}

const FILTER_KEYS = ["target", "scenario", "release", "result", "q"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

/** Filters live in the URL, so a filtered view can be shared and Back works. */
export function useRunFilters() {
  const sp = useSearchParams();
  const nav = useNavigate();
  const result = sp.get("result");
  const filters: RunFilters = {
    target: sp.get("target") ?? undefined,
    scenario: sp.get("scenario") ?? undefined,
    release: sp.get("release") ?? undefined,
    result: result === "pass" || result === "fail" ? result : undefined,
    q: sp.get("q") ?? undefined,
  };
  const activeCount = FILTER_KEYS.filter((k) => k !== "q" && filters[k]).length;

  const replace = (next: URLSearchParams) => {
    const qs = next.toString();
    // Always the list's own URL: changing a filter while the Create run sheet is open (/runs/new) closes it.
    nav.replace(qs ? `/runs?${qs}` : "/runs", { scroll: false });
  };
  return {
    filters,
    activeCount,
    /** A filter change is loading. */
    pending: nav.pending,
    /** Development switch for the page's states (`?simulate=error|forbidden|empty|idle|slow`). */
    simulate: sp.get("simulate") ?? undefined,
    /** Set by Create run: the run to highlight once. Dropped by any filter change. */
    created: sp.get("created") ?? undefined,
    setFilter(key: FilterKey, value: string | undefined) {
      const next = new URLSearchParams(sp);
      next.delete("created");
      if (value) next.set(key, value);
      else next.delete(key);
      replace(next);
    },
    clear() {
      const next = new URLSearchParams(sp);
      next.delete("created");
      FILTER_KEYS.forEach((k) => next.delete(k));
      replace(next);
    },
  };
}

type Page = RunPage & { projectId: string };

export function useRuns(projectId: string, filters: RunFilters, simulate?: string) {
  return useInfiniteQuery({
    queryKey: ["runs", projectId, filters, simulate],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<Page> => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
      if (pageParam) p.set("cursor", pageParam);
      if (simulate) p.set("simulate", simulate);
      const res = await fetch(`/api/runs?${p}`, { signal, cache: "no-store" });
      if (!res.ok) throw new RunsError(res.status);
      return res.json();
    },
    getNextPageParam: (last) => last.nextCursor,
    // Keep the "In progress" band fresh while something is in flight. SSE replaces this in UI-09.
    refetchInterval: (q) => (q.state.data?.pages[0]?.active.length ? 5000 : false),
    // While filters change, keep showing the old rows instead of flashing a skeleton — but never another project's rows.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === projectId ? prev : undefined),
    retry: (count, error) => !(error instanceof RunsError && error.status < 500) && count < 1,
  });
}
