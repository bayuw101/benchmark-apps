"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, CircleCheck, Pin, ShieldAlert, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { clock, relativeTime } from "@/lib/time";
import { ABORT_LABEL, PRESET_LABEL, type RunDetail, type VerdictCaveat } from "@/lib/runs/types";
import { browserCells, integrityBreach, integritySourceFailed, PAYMENT_CONFIRMATION_BUDGET_MS } from "@/lib/runs/results";
import { Badge } from "@/components/ui/badge";
import { LinkPending } from "@/components/arbiter/link-pending";
import { ThresholdMetricCard } from "@/components/btb/threshold-metric-card";
import { ReleaseTrend } from "@/components/btb/release-trend-chart";
import { VerdictBanner } from "@/components/btb/verdict-banner";
import { Hint } from "@/components/ui/tooltip";

const fmt = (n: number) => n.toLocaleString("en-US");

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
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

function caveatText(c: VerdictCaveat, d: RunDetail) {
  const r = d.results!;
  if (c === "measurement_gap") return `Telemetry missed ${r.gapSec} s, so numbers in that window are estimates.`;
  if (c === "generator_saturated") return `The load generators hit their limit (see the timeline), so latency may be inflated and the target wasn't fully tested (${fmt(r.achieved.load)} of ${fmt(r.planned.load)} ${r.planned.unit} reached).`;
  return integritySourceFailed(d)
    ? "The target's integrity source didn't answer (see the timeline), so oversold seats and double charges weren't checked."
    : "No read-only data source for this target yet, so oversold seats and double charges weren't checked.";
}

/** Delta against the baseline: red when worse (higher latency or errors, lower throughput). */
function Delta({ base, now, unit, higherIsWorse, decimals = 0 }: { base: number; now: number; unit: string; higherIsWorse: boolean; decimals?: number }) {
  const diff = now - base;
  const pct = base ? (diff / base) * 100 : 0;
  const worse = higherIsWorse ? diff > 0 : diff < 0;
  const flat = Math.abs(pct) < 2;
  const Icon = diff > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium tabular-nums", flat ? "text-muted-foreground" : worse ? "text-danger" : "text-success")}>
      {flat ? null : <Icon className="size-3.5" />}
      {diff > 0 ? "+" : ""}
      {diff.toFixed(decimals)} {unit} ({pct > 0 ? "+" : ""}
      {pct.toFixed(0)}%)
    </span>
  );
}

const pct = (part: number, whole: number) => (whole ? (part / whole) * 100 : 0);
const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

/** E7.4: where users dropped out of the journey and how long each step took (retries and polling included). */
function JourneyFunnel({ journey }: { journey: NonNullable<NonNullable<RunDetail["results"]>["journey"]> }) {
  const first = journey.steps[0]?.reached ?? 0;
  const done = journey.steps.at(-1)?.completed ?? 0;
  const p2c = journey.paymentToConfirmationP95Ms;
  const p2cOk = p2c === null || p2c <= PAYMENT_CONFIRMATION_BUDGET_MS;
  return (
    <Section
      title="Journey steps"
      aside={
        <span className="text-xs text-muted-foreground tabular-nums">
          {fmt(done)} of {fmt(first)} finished ({pct(done, first).toFixed(0)}%)
        </span>
      }
    >
      <div className="grid gap-4">
        {p2c !== null ? (
          <div className={cn("flex flex-wrap items-baseline justify-between gap-2 rounded-md border px-3 py-2.5", p2cOk ? "border-border" : "border-danger/30 bg-danger-soft")}>
            <span className="text-sm text-muted-foreground">Payment → confirmation, p95</span>
            <span className={cn("text-sm font-semibold tabular-nums", p2cOk ? "" : "text-danger")}>
              {seconds(p2c)} <span className="text-xs font-normal text-muted-foreground">budget ≤ {seconds(PAYMENT_CONFIRMATION_BUDGET_MS)}</span>
            </span>
          </div>
        ) : null}
        <div className="-mx-5 -mb-5 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-y border-border text-left text-xs text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">Step</th>
                <th className="w-2/5 px-3 py-2.5 font-medium">Finished the step</th>
                <th className="px-3 py-2.5 text-right font-medium">Dropped</th>
                <th className="px-5 py-2.5 text-right font-medium">p95</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {journey.steps.map((s) => {
                const dropped = s.reached - s.completed;
                return (
                  <tr key={s.step}>
                    <td className="px-5 py-2.5 font-medium">{s.step}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <Hint label={`${fmt(s.completed)} of ${fmt(s.reached)} finished · ${pct(s.completed, first).toFixed(0)}% of all who started`}>
                          <div className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${pct(s.completed, first)}%` }} />
                          </div>
                        </Hint>
                        <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                          {fmt(s.completed)} / {fmt(s.reached)}
                        </span>
                      </div>
                    </td>
                    <td className={cn("px-3 py-2.5 text-right tabular-nums", dropped ? "font-medium text-warning" : "text-muted-foreground")}>
                      {dropped ? `${fmt(dropped)} (${pct(dropped, s.reached).toFixed(1)}%)` : "0"}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{s.p95Ms === null ? "—" : `${fmt(s.p95Ms)} ms`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  );
}

/** UI-10 results: verdict and caveats, load numbers, planned vs achieved, baseline, browser timings, integrity. */
export function RunResultsSection({ d, now }: { d: RunDetail; now: Date }) {
  const r = d.results;
  if (!r || !d.verdict) return null;
  const pass = d.verdict.result === "pass";
  const t = r.thresholds;
  const failed = [
    !r.checks.p95 && t ? `p95 ${fmt(r.p95Ms)} ms is over the ${fmt(t.p95Ms)} ms threshold` : null,
    !r.checks.errors && t ? `errors ${r.errorRatePct}% are over the ${t.errorRatePct}% threshold` : null,
    integrityBreach(r.integrity) ? `integrity broken: ${integrityBreach(r.integrity)}` : null,
  ].filter(Boolean);
  const summary = pass
    ? `p95 ${fmt(r.p95Ms)} ms and errors ${r.errorRatePct}% stayed within their thresholds.`
    : `${failed.join("; ").replace(/^(errors|integrity)/, (w) => w[0].toUpperCase() + w.slice(1))}.${d.status === "aborted" && d.abortReason ? ` Aborted: ${ABORT_LABEL[d.abortReason]}.` : ""}`;
  const loadPct = Math.min(100, (r.achieved.load / r.planned.load) * 100);
  const timePct = Math.min(100, (r.achieved.durationSec / r.planned.durationSec) * 100);
  const regression =
    d.baseline?.compare &&
    (d.baseline.compare.p95Ms.now > d.baseline.compare.p95Ms.base * 1.1 ||
      d.baseline.compare.errorRatePct.now - d.baseline.compare.errorRatePct.base > 0.2 ||
      d.baseline.compare.peakRps.now < d.baseline.compare.peakRps.base * 0.9);

  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="grid gap-2">
        <VerdictBanner verdict={d.verdict.result} summary={summary} caveats={r.caveats} />
        {r.caveats.length ? (
          <ul className="grid gap-1 px-1 text-xs text-muted-foreground">
            {r.caveats.map((c) => (
              <li key={c} className="flex items-start gap-1.5">
                <TriangleAlert className="mt-px size-3.5 shrink-0 text-warning" />
                {caveatText(c, d)}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <ThresholdMetricCard label="p50 latency" value={fmt(r.p50Ms)} unit="ms" />
        <ThresholdMetricCard label="p95 latency" value={fmt(r.p95Ms)} unit="ms" threshold={t ? `≤ ${fmt(t.p95Ms)} ms` : undefined} pass={t ? r.checks.p95 : undefined} />
        <ThresholdMetricCard label="p99 latency" value={fmt(r.p99Ms)} unit="ms" />
        <ThresholdMetricCard label="Error rate" value={String(r.errorRatePct)} unit="%" threshold={t ? `≤ ${t.errorRatePct}%` : undefined} pass={t ? r.checks.errors : undefined} />
        <ThresholdMetricCard label="Peak RPS" value={fmt(r.peakRps)} />
        <ThresholdMetricCard label="Max VUs" value={fmt(r.maxVus)} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Section title="Planned vs achieved">
          <div className="grid gap-4">
            {[
              { label: "Load", value: `${fmt(r.achieved.load)} of ${fmt(r.planned.load)} ${r.planned.unit}`, pct: loadPct, low: loadPct < 90 },
              { label: "Duration", value: `${clock(r.achieved.durationSec)} of ${clock(r.planned.durationSec)}`, pct: timePct, low: timePct < 99 },
            ].map((row) => (
              <div key={row.label} className="grid gap-1.5">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="font-medium tabular-nums">
                    {row.value} <span className={cn("text-xs", row.low ? "text-warning" : "text-muted-foreground")}>({row.pct.toFixed(0)}%)</span>
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className={cn("h-full rounded-full", row.low ? "bg-warning" : "bg-success")} style={{ width: `${row.pct}%` }} />
                </div>
              </div>
            ))}
            {timePct < 99 ? <p className="text-xs text-muted-foreground">The run stopped early, so later parts of the load profile never ran.</p> : null}
          </div>
        </Section>

        <Section
          title="Baseline"
          aside={d.baseline?.isThis ? <Badge tone="info"><Pin />This run</Badge> : regression ? <Badge tone="danger">Regression</Badge> : d.baseline?.compare ? <Badge tone="success">No regression</Badge> : null}
        >
          {d.baseline?.isThis ? (
            <p className="text-sm text-muted-foreground">
              This run is the baseline for {d.scenario.name} · {PRESET_LABEL[d.preset]} on <span className="font-mono text-xs">{d.target.name}</span>. Pinned by {d.baseline.setBy}{" "}
              {relativeTime(new Date(d.baseline.setAt), now)}. Later runs compare against it.
            </p>
          ) : d.baseline?.compare ? (
            <div className="grid gap-3">
              <p className="text-xs text-muted-foreground">
                Against{" "}
                <Link href={`/runs/${d.baseline.runId}`} className="font-mono font-medium text-foreground underline-offset-2 hover:underline">
                  {d.baseline.runId}
                  <LinkPending className="ml-1 inline-block size-3 align-[-1px]" />
                </Link>
                , pinned by {d.baseline.setBy}.
              </p>
              <dl className="divide-y divide-border rounded-md border border-border">
                {[
                  { k: "p95 latency", base: d.baseline.compare.p95Ms.base, now: d.baseline.compare.p95Ms.now, unit: "ms", worse: true, dec: 0 },
                  { k: "Error rate", base: d.baseline.compare.errorRatePct.base, now: d.baseline.compare.errorRatePct.now, unit: "pp", worse: true, dec: 2 },
                  { k: "Peak RPS", base: d.baseline.compare.peakRps.base, now: d.baseline.compare.peakRps.now, unit: "", worse: false, dec: 0 },
                ].map((m) => (
                  <div key={m.k} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-3 py-2">
                    <dt className="text-sm">{m.k}</dt>
                    <dd className="text-right text-sm font-medium tabular-nums">
                      {m.dec ? m.now.toFixed(2) : fmt(m.now)}
                      <span className="text-xs font-normal text-muted-foreground"> vs {m.dec ? m.base.toFixed(2) : fmt(m.base)}</span>
                    </dd>
                    <dd className="col-span-2 text-right">
                      <Delta base={m.base} now={m.now} unit={m.unit} higherIsWorse={m.worse} decimals={m.dec} />
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No baseline yet for {d.scenario.name} · {PRESET_LABEL[d.preset]} on <span className="font-mono text-xs">{d.target.name}</span>.
              {d.canBaseline ? " Set this run as the baseline to compare later runs against it." : " Pin a completed run as the baseline to compare against it."}
            </p>
          )}
        </Section>
      </div>

      {r.journey?.steps.length ? <JourneyFunnel journey={r.journey} /> : null}

      {d.trend.length >= 2 ? (
        <Section
          title="Release trend"
          aside={
            <span className="text-xs text-muted-foreground">
              Latest completed run per release · {d.scenario.name} · {PRESET_LABEL[d.preset]} on <span className="font-mono">{d.target.name}</span>
            </span>
          }
        >
          <ReleaseTrend points={d.trend} currentRunId={d.id} thresholds={r.thresholds} />
        </Section>
      ) : null}

      {r.browser ? (
        <Section title="Browser results" aside={<span className="text-xs text-muted-foreground">p75 per step · {d.network === "wifi-baseline" ? "Wi-Fi baseline" : "Stadium 4G"}</span>}>
          <div className="-mx-5 -my-5 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-5 py-2.5 font-medium">Step</th>
                  <th className="px-3 py-2.5 font-medium">LCP ≤ 2.5 s</th>
                  <th className="px-3 py-2.5 font-medium">INP ≤ 200 ms</th>
                  <th className="px-3 py-2.5 font-medium">CLS ≤ 0.1</th>
                  <th className="px-3 py-2.5 font-medium">FCP ≤ 1.8 s</th>
                  <th className="px-3 py-2.5 font-medium">TTFB ≤ 0.8 s</th>
                  <th className="px-5 py-2.5 font-medium">TBT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {r.browser.map((s) => (
                  <tr key={s.step}>
                    <td className="px-5 py-2.5 font-medium">{s.step}</td>
                    {browserCells(s).map((c, i) => (
                      <td key={i} className={cn("px-3 py-2.5 tabular-nums", c.ok ? "" : "font-medium text-danger")}>
                        {c.text}
                      </td>
                    ))}
                    <td className="px-5 py-2.5 text-xs text-muted-foreground">Not measured (Phase 2)</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}

      <Section
        title="Integrity"
        aside={
          !r.integrity ? (
            <Badge tone="warning">Not verified</Badge>
          ) : integrityBreach(r.integrity) ? (
            <Badge tone="danger" dot>
              Broken
            </Badge>
          ) : (
            <Badge tone="success" dot>
              Verified
            </Badge>
          )
        }
      >
        {r.integrity ? (
          <div className="grid gap-3">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                ["Oversold seats", r.integrity.oversoldSeats],
                ["Double charges", r.integrity.doubleCharges],
                ["Charged without a ticket", r.integrity.chargedNoTicket],
              ].map(([k, v]) => (
                <div key={k} className={cn("rounded-md border px-3 py-2.5", v ? "border-danger/30 bg-danger-soft" : "border-border")}>
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className={cn("flex items-center gap-1.5 text-2xl font-semibold tabular-nums", v ? "text-danger" : "")}>
                    {v}
                    {v ? null : <CircleCheck className="size-4 text-success" />}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-muted-foreground">From a read-only reconciliation of orders, seats, payments and tickets after the run. The rule is zero of each.</p>
          </div>
        ) : (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            Oversold seats, double charges and charged-without-ticket weren&apos;t checked:{" "}
            {integritySourceFailed(d) ? "the target's read-only source didn't answer (see the timeline)." : "this target has no read-only data source yet."} The verdict carries the caveat
            “integrity not verified”.
          </p>
        )}
        {r.journey?.counts ? (
          <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground tabular-nums">
            The journey counted {fmt(r.journey.counts.order)} orders, {fmt(r.journey.counts.seat)} seats, {fmt(r.journey.counts.ticket)} tickets and{" "}
            {fmt(r.journey.counts.charge)} charges. These are its own view, to check against the target&apos;s records.
          </p>
        ) : null}
      </Section>
    </div>
  );
}
