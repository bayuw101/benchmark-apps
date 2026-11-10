"use client";

import { useMemo, useState } from "react";
import { Gauge, Plus, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable, cell, type Column } from "@/components/arbiter/data-table";
import { EmptyState } from "@/components/arbiter/empty-state";
import { MetricCard } from "@/components/arbiter/metric-card";
import { PageHeader } from "@/components/arbiter/page-header";
import { SearchInput } from "@/components/arbiter/search-input";
import { RunStatusBadge } from "@/components/btb/run-status-badge";
import type { RunStatus } from "@/lib/run-status";
import { Demo, GallerySection } from "./section";

interface RunRow {
  id: string;
  scenario: string;
  target: string;
  preset: string;
  status: RunStatus;
  verdict?: "pass" | "fail";
  by: string;
}

const RUNS: RunRow[] = [
  { id: "RUN-0421", scenario: "Kickoff surge · v3", target: "tickets-staging", preset: "Spike", status: "running", by: "Bayu W." },
  { id: "RUN-0420", scenario: "Checkout · v7", target: "tickets-staging", preset: "Peak", status: "pending_approval", by: "Ahwalian" },
  { id: "RUN-0419", scenario: "Seat map browse · v2", target: "tickets-staging", preset: "Baseline", status: "completed", verdict: "pass", by: "Bayu W." },
  { id: "RUN-0418", scenario: "Checkout · v6", target: "tickets-staging", preset: "Peak", status: "aborted", verdict: "fail", by: "Ahwalian" },
  { id: "RUN-0417", scenario: "Login · v4", target: "auth-staging", preset: "Smoke", status: "queued", by: "Bayu W." },
];

const COLUMNS: Column<RunRow>[] = [
  { key: "id", header: "Run", className: cell.mono },
  { key: "scenario", header: "Scenario", className: cell.primary },
  { key: "target", header: "Target" },
  { key: "preset", header: "Preset" },
  { key: "status", header: "Status", render: (r) => <RunStatusBadge status={r.status} /> },
  {
    key: "verdict",
    header: "Verdict",
    render: (r) =>
      r.verdict ? <Badge tone={r.verdict === "pass" ? "success" : "danger"}>{r.verdict === "pass" ? "Pass" : "Fail"}</Badge> : <span className="text-muted-foreground">—</span>,
  },
  { key: "by", header: "Created by", className: "text-muted-foreground" },
];

export function DataDisplaySection() {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string>();
  const rows = useMemo(
    () => RUNS.filter((r) => `${r.id} ${r.scenario} ${r.target}`.toLowerCase().includes(q.toLowerCase())),
    [q],
  );

  function reload() {
    setLoading(true);
    setTimeout(() => setLoading(false), 1200);
  }

  return (
    <GallerySection id="display" title="Data display" description="One giant number per page, skeleton rows while loading, an empty state that offers the next step.">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <MetricCard hero label="p95 latency, last run" value={<>612<span className="ml-1 text-2xl text-muted-foreground">ms</span></>} trend={{ direction: "up", label: "18% faster" }} description="Threshold 800 ms · checkout journey" />
        <div className="grid gap-2">
          <MetricCard label="Peak RPS" value="1,184" />
          <MetricCard label="Error rate" value="0.42%" trend={{ direction: "down", label: "+0.1 pt" }} />
        </div>
      </div>

      <div className="grid gap-3">
        <PageHeader
          title="Recent runs"
          description="Click a row to select it. Search filters by run, scenario or target."
          actions={
            <>
              <SearchInput label="Search runs" onSearch={setQ} shortcut="/" />
              <Button size="sm" variant="outline" icon={<RefreshCw />} loading={loading} onClick={reload}>Reload</Button>
              <Button size="sm" icon={<Plus />}>Create run</Button>
            </>
          }
        />
        <DataTable
          label="Recent runs"
          columns={COLUMNS}
          rows={rows}
          getRowKey={(r) => r.id}
          isLoading={loading}
          hasActiveFilter={q.length > 0}
          onRowClick={(r) => setSelected(r.id)}
          selectedKey={selected}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <EmptyState
          icon={<Gauge />}
          title="No runs yet"
          description="Create a run to load-test a target with an approved scenario."
          action={<Button size="sm" icon={<Plus />}>Create run</Button>}
        />
        <Demo label="Skeleton">
          <div className="flex items-center gap-3">
            <Skeleton className="size-8 rounded-full" />
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-3 w-2/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
          </div>
          <Skeleton className="h-24" />
        </Demo>
      </div>
    </GallerySection>
  );
}
