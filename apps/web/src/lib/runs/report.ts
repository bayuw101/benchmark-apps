import "server-only";

import { PRESETS } from "@btb/core/policy";
import { ABORT_LABEL, CAVEAT_LABEL, PRESET_LABEL, type RunDetail } from "./types";
import { browserCells, integrityBreach, integritySourceFailed, PAYMENT_CONFIRMATION_BUDGET_MS } from "./results";
import type { LiveSample } from "@btb/contracts";

/*
 * The run report (UI-11, PRD E9.6 / story 38): ONE self-contained HTML file. Inline CSS, static SVG charts, no
 * external requests, an A4 print stylesheet, and "Download PDF" through the browser's print dialog. Content
 * follows the reporting checklist: scenario and version, target and environment, window, approvals, intended vs
 * achieved load, p50/p95/p99, errors, baseline comparison, verdict, caveats, recommended next test.
 */

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmt = (n: number) => n.toLocaleString("en-US");
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC" : "—");
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

/** What to run next, from what this run showed. */
export function recommendNext(d: RunDetail): string {
  const r = d.results!;
  if (integrityBreach(r.integrity)) return `Find where the ${integrityBreach(r.integrity)} came from in the target's order, payment and ticket records, fix it, then repeat this run.`;
  if (r.caveats.includes("generator_saturated")) return `Add runner capacity and repeat this ${PRESET_LABEL[d.preset].toLowerCase()} run: the generators maxed out, so the target wasn't fully tested.`;
  if (!r.checks.p95) return `Find the slow step in Grafana (per-endpoint breakdown), fix it, then repeat this ${PRESET_LABEL[d.preset].toLowerCase()} run and compare against the baseline.`;
  if (!r.checks.errors) return "Check the error responses in the logs and k6 summary, fix the cause, then repeat this run.";
  if (d.status === "aborted") return "Find out why the run stopped (see the abort reason), then repeat it.";
  const next: Partial<Record<string, string>> = {
    smoke: "Run Baseline next: the journey works, so measure normal load.",
    baseline: "Run Peak next to check the target at its reference peak.",
    peak: "Run Spike next (idle to 5× peak within a minute). It needs one approver.",
    spike: "Run Soak next (4 hours) to look for leaks and slow degradation.",
    stress: "Pin this run as the baseline if it is the new normal, then repeat after each release.",
    soak: "Pin this run as the baseline and repeat it before the next big release.",
  };
  const base = next[d.preset] ?? "Repeat after the next release and compare against the baseline.";
  if (r.integrity) return base;
  return integritySourceFailed(d) ? `${base} Also find out why the integrity source didn't answer (see the timeline).` : `${base} Also arrange read-only database access so integrity can be verified (TBD-13).`;
}

/** A static line chart: samples over time, an optional dashed threshold, y axis from 0. */
function svgChart(title: string, unit: string, points: { x: number; y: number }[], durationSec: number, threshold?: number) {
  const W = 320;
  const H = 120;
  const pad = { l: 36, r: 8, t: 8, b: 18 };
  const maxY = Math.max(threshold ?? 0, ...points.map((p) => p.y), 1) * 1.15;
  const x = (v: number) => pad.l + (v / Math.max(1, durationSec)) * (W - pad.l - pad.r);
  const y = (v: number) => H - pad.b - (v / maxY) * (H - pad.t - pad.b);
  const line = points.map((p) => `${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ");
  // Small ranges (error rate in %) need decimals, or the axis reads "1, 1, 0".
  const tick = (v: number) => (maxY < 10 ? v.toFixed(maxY < 2 ? 2 : 1) : fmt(Math.round(v)));
  const ticks = [0, maxY / 2, maxY].map((v) => `<text x="${pad.l - 4}" y="${y(v) + 3}" text-anchor="end">${tick(v)}</text><line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/>`).join("");
  const th = threshold !== undefined ? `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(threshold)}" y2="${y(threshold)}" class="threshold"/><text x="${W - pad.r}" y="${y(threshold) - 3}" text-anchor="end" class="threshold-label">threshold ${fmt(threshold)} ${esc(unit)}</text>` : "";
  return `<figure class="chart"><figcaption>${esc(title)} <span>(${esc(unit)})</span></figcaption>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)} over time">${ticks}${th}
<polyline points="${line}" class="series"/>
<text x="${pad.l}" y="${H - 4}">0:00</text><text x="${W - pad.r}" y="${H - 4}" text-anchor="end">${mmss(durationSec)}</text></svg></figure>`;
}

export function renderReport(d: RunDetail, samples: LiveSample[], logoDataUri: string | null, generatedAt: Date): string {
  const r = d.results!;
  const pass = d.verdict?.result === "pass";
  const t = r.thresholds;
  const preset = PRESETS[d.preset];
  const scenario = d.manifest.scenario as { name: string; version: number; journey: string; imageVersion?: string } | undefined;
  const cmp = d.baseline?.compare;
  const pct = (a: number, b: number) => (b ? `${a >= b ? "+" : ""}${(((a - b) / b) * 100).toFixed(0)}%` : "—");

  const row = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
  const approvals = d.approvalRecords.length
    ? d.approvalRecords.map((a) => (a.rule ? `Auto-approved by policy (${esc(a.rule)})` : `${esc(a.by)}, ${esc(when(a.at))}`)).join("<br>")
    : "None recorded";

  const metric = (label: string, value: string, note = "", state: "pass" | "fail" | "" = "") =>
    `<div class="metric ${state}"><div class="label">${esc(label)}</div><div class="value">${value}</div>${note ? `<div class="note">${note}</div>` : ""}</div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.id)} report · ${esc(d.scenario.name)} · Arbiter Benchmark</title>
<style>
  :root { --ink:#111827; --muted:#6b7280; --line:#e5e7eb; --soft:#f9fafb; --pass:#047857; --pass-bg:#ecfdf5; --fail:#b91c1c; --fail-bg:#fef2f2; --warn:#b45309; --warn-bg:#fffbeb; --brand:#2563eb; }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body { margin: 0; background: #f3f4f6; color: var(--ink); font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
  .toolbar { position: sticky; top: 0; display: flex; gap: 8px; justify-content: flex-end; padding: 10px 16px; background: rgba(255,255,255,.9); border-bottom: 1px solid var(--line); backdrop-filter: blur(6px); }
  .toolbar button, .toolbar a { font: 600 12px/1 inherit; padding: 9px 12px; border-radius: 8px; border: 1px solid var(--line); background: #fff; color: var(--ink); cursor: pointer; text-decoration: none; }
  .toolbar .primary { background: var(--ink); color: #fff; border-color: var(--ink); }
  .page { max-width: 210mm; margin: 24px auto; background: #fff; padding: 18mm 16mm; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  header.top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid var(--ink); padding-bottom: 12px; }
  header.top img { height: 22px; }
  .brand { display: flex; align-items: center; gap: 8px; font-weight: 700; }
  h1 { font-size: 22px; line-height: 1.2; margin: 14px 0 2px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 22px 0 8px; break-after: avoid; }
  .sub { color: var(--muted); }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
  .verdict { display: flex; gap: 14px; align-items: center; border: 1px solid; border-radius: 10px; padding: 14px 16px; margin-top: 16px; break-inside: avoid; }
  .verdict.pass { border-color: #a7f3d0; background: var(--pass-bg); }
  .verdict.fail { border-color: #fecaca; background: var(--fail-bg); }
  .verdict .word { font-size: 28px; font-weight: 800; }
  .verdict.pass .word { color: var(--pass); } .verdict.fail .word { color: var(--fail); }
  .caveats { margin: 8px 0 0; padding: 0; list-style: none; }
  .caveats li { color: var(--warn); }
  .caveats li::before { content: "⚠ "; }
  table.facts { width: 100%; border-collapse: collapse; }
  table.facts th, table.facts td { text-align: left; vertical-align: top; padding: 6px 0; border-bottom: 1px solid var(--line); }
  table.facts th { width: 34%; color: var(--muted); font-weight: 500; }
  /* Long values (the 64-character hash) wrap instead of widening the page past the A4 margin. */
  table.facts td { overflow-wrap: anywhere; }
  table.facts { table-layout: fixed; }
  .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .metric { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; break-inside: avoid; }
  .metric .label { color: var(--muted); font-size: 11px; }
  .metric .value { font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .metric .note { color: var(--muted); font-size: 11px; }
  .metric.pass .note { color: var(--pass); } .metric.fail .note { color: var(--fail); } .metric.fail .value { color: var(--fail); }
  .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .chart { margin: 0; border: 1px solid var(--line); border-radius: 8px; padding: 8px; break-inside: avoid; }
  .chart figcaption { font-size: 11px; font-weight: 600; } .chart figcaption span { color: var(--muted); font-weight: 400; }
  .chart svg { width: 100%; height: auto; display: block; font-size: 8px; fill: var(--muted); }
  .chart .grid { stroke: var(--line); stroke-width: .5; } .chart .series { fill: none; stroke: var(--ink); stroke-width: 1.4; }
  .chart .threshold { stroke: var(--fail); stroke-dasharray: 4 3; stroke-width: 1; } .chart .threshold-label { fill: var(--fail); }
  table.data { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  table.data th, table.data td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); }
  table.data th { color: var(--muted); font-weight: 500; font-size: 11px; }
  table.data tr.this td { font-weight: 600; }
  .worse { color: var(--fail); font-weight: 600; } .better { color: var(--pass); font-weight: 600; } .bad { color: var(--fail); font-weight: 600; }
  .next { border-left: 3px solid var(--brand); background: var(--soft); padding: 10px 12px; break-inside: avoid; }
  footer { margin-top: 24px; padding-top: 10px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11px; }
  @page { size: A4; margin: 14mm 12mm; }
  @media print {
    body { background: #fff; font-size: 11px; }
    .toolbar { display: none; }
    /* 1 mm inside the A4 margin, so right-hand borders aren't cut off at the edge of the printable area. */
    .page { box-shadow: none; margin: 0; padding: 0 1mm; max-width: none; }
    a { color: inherit; text-decoration: none; }
    .verdict, .metric, .chart, .next { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
  @media (max-width: 640px) { .page { margin: 0; padding: 20px 16px; } .metrics { grid-template-columns: 1fr 1fr; } .charts { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<div class="toolbar" role="toolbar" aria-label="Report actions">
  <a href="?download=1" download="${esc(d.id)}-report.html">Download HTML</a>
  <button type="button" class="primary" onclick="window.print()">Download PDF</button>
</div>
<main class="page">
  <header class="top">
    <div class="brand">${logoDataUri ? `<img src="${logoDataUri}" alt="">` : ""}<span>Arbiter Benchmark</span></div>
    <div class="sub" style="text-align:right">Run report<br><span class="mono">${esc(d.id)}</span></div>
  </header>

  <h1>${esc(d.scenario.name)} v${esc(d.scenario.version)} · ${esc(PRESET_LABEL[d.preset])}</h1>
  <div class="sub">${esc(d.projectName)} · <span class="mono">${esc(d.target.name)}</span> · ${esc(d.environment === "prod-like" ? "Prod-like" : "Staging")}${d.releaseId ? ` · Release <span class="mono">${esc(d.releaseId)}</span>` : ""}</div>

  <section class="verdict ${pass ? "pass" : "fail"}" aria-label="Verdict">
    <div class="word">${pass ? "PASS" : "FAIL"}</div>
    <div>
      <div>${
        pass
          ? `p95 ${fmt(r.p95Ms)} ms and errors ${r.errorRatePct}% stayed within their thresholds.`
          : [!r.checks.p95 && t ? `p95 ${fmt(r.p95Ms)} ms was over the ${fmt(t.p95Ms)} ms threshold.` : "", !r.checks.errors && t ? `Errors ${r.errorRatePct}% were over the ${t.errorRatePct}% threshold.` : "", integrityBreach(r.integrity) ? `Integrity broken: ${integrityBreach(r.integrity)}.` : ""].filter(Boolean).join(" ")
      }${d.status === "aborted" && d.abortReason ? ` Aborted: ${esc(ABORT_LABEL[d.abortReason])}.` : ""}</div>
      ${r.caveats.length ? `<ul class="caveats">${r.caveats.map((c) => `<li>${esc(CAVEAT_LABEL[c])}</li>`).join("")}</ul>` : ""}
    </div>
  </section>

  <h2>Plan</h2>
  <table class="facts">
    ${row("Scenario", `${esc(d.scenario.name)} v${esc(d.scenario.version)} · journey <span class="mono">${esc(scenario?.journey ?? "")}</span>${scenario?.imageVersion ? ` · runner image <span class="mono">${esc(scenario.imageVersion)}</span>` : ""}`)}
    ${row("Target and environment", `<span class="mono">${esc(d.target.name)}</span> · ${esc(d.environment)}`)}
    ${row("Load preset", `${esc(preset.label)}: ${esc(preset.description)}`)}
    ${row("Thresholds (abort on fail)", t ? `p95 ≤ ${fmt(t.p95Ms)} ms · errors ≤ ${t.errorRatePct}%` : "None")}
    ${row("Window", `${esc(when(d.startedAt))} to ${esc(when(d.endedAt))} (${mmss(r.achieved.durationSec)} of ${mmss(r.planned.durationSec)} planned)`)}
    ${row("Approvals", approvals)}
    ${row("Created by", `${esc(d.createdBy.name)}, ${esc(when(d.createdAt))}`)}
    ${row("Manifest hash (SHA-256)", `<span class="mono">${esc(d.manifestHash)}</span>`)}
    ${row("Versions", `web <span class="mono">${esc(d.versions.web ?? "—")}</span> · worker <span class="mono">${esc(d.versions.worker ?? "—")}</span> · runner <span class="mono">${esc(d.versions.runner)}</span>`)}
  </table>

  <h2>Results</h2>
  <div class="metrics">
    ${metric("Intended vs achieved load", `${fmt(r.achieved.load)} <span class="sub" style="font-size:12px;font-weight:500">of ${fmt(r.planned.load)} ${esc(r.planned.unit)}</span>`, `${((r.achieved.load / r.planned.load) * 100).toFixed(0)}% of plan`)}
    ${metric("p50 latency", `${fmt(r.p50Ms)} ms`)}
    ${metric("p95 latency", `${fmt(r.p95Ms)} ms`, t ? `threshold ≤ ${fmt(t.p95Ms)} ms · ${r.checks.p95 ? "pass" : "fail"}` : "", t ? (r.checks.p95 ? "pass" : "fail") : "")}
    ${metric("p99 latency", `${fmt(r.p99Ms)} ms`)}
    ${metric("Error rate", `${r.errorRatePct}%`, t ? `threshold ≤ ${t.errorRatePct}% · ${r.checks.errors ? "pass" : "fail"}` : "", t ? (r.checks.errors ? "pass" : "fail") : "")}
    ${metric("Peak RPS · max VUs", `${fmt(r.peakRps)} · ${fmt(r.maxVus)}`)}
  </div>

  ${
    samples.length
      ? `<h2>Over time</h2><div class="charts">
    ${svgChart("p95 latency", "ms", samples.map((s) => ({ x: s.elapsedSec, y: s.p95Ms })), r.planned.durationSec, t?.p95Ms)}
    ${svgChart("Error rate", "%", samples.map((s) => ({ x: s.elapsedSec, y: s.errorRatePct })), r.planned.durationSec, t?.errorRatePct)}
    ${svgChart("Virtual users", "VUs", samples.map((s) => ({ x: s.elapsedSec, y: s.vus })), r.planned.durationSec)}
    ${svgChart("Requests per second", "RPS", samples.map((s) => ({ x: s.elapsedSec, y: s.rps })), r.planned.durationSec)}
  </div>`
      : ""
  }

  <h2>Baseline comparison</h2>
  ${
    d.baseline?.isThis
      ? `<p>This run is the baseline for ${esc(d.scenario.name)} · ${esc(PRESET_LABEL[d.preset])} on <span class="mono">${esc(d.target.name)}</span> (pinned by ${esc(d.baseline.setBy)}).</p>`
      : cmp
        ? `<table class="data"><thead><tr><th>Metric</th><th>This run</th><th>Baseline <span class="mono">${esc(d.baseline!.runId)}</span></th><th>Change</th></tr></thead><tbody>
      <tr><td>p95 latency</td><td>${fmt(cmp.p95Ms.now)} ms</td><td>${fmt(cmp.p95Ms.base)} ms</td><td class="${cmp.p95Ms.now > cmp.p95Ms.base ? "worse" : "better"}">${pct(cmp.p95Ms.now, cmp.p95Ms.base)}</td></tr>
      <tr><td>Error rate</td><td>${cmp.errorRatePct.now}%</td><td>${cmp.errorRatePct.base}%</td><td class="${cmp.errorRatePct.now > cmp.errorRatePct.base ? "worse" : "better"}">${(cmp.errorRatePct.now - cmp.errorRatePct.base).toFixed(2)} pp</td></tr>
      <tr><td>Peak RPS</td><td>${fmt(cmp.peakRps.now)}</td><td>${fmt(cmp.peakRps.base)}</td><td class="${cmp.peakRps.now < cmp.peakRps.base ? "worse" : "better"}">${pct(cmp.peakRps.now, cmp.peakRps.base)}</td></tr>
    </tbody></table>`
        : `<p class="sub">No baseline for ${esc(d.scenario.name)} · ${esc(PRESET_LABEL[d.preset])} on this target yet.</p>`
  }

  ${
    d.trend.length >= 2
      ? `<h2>Release trend</h2><table class="data"><thead><tr><th>Release</th><th>Run</th><th>p95</th><th>Errors</th><th>Peak RPS</th><th>Verdict</th></tr></thead><tbody>
    ${d.trend
      .map(
        (p) =>
          `<tr${p.runId === d.id ? ' class="this"' : ""}><td class="mono">${esc(p.releaseId)}</td><td class="mono">${esc(p.runId)}${p.runId === d.id ? " (this run)" : ""}</td><td>${fmt(p.p95Ms)} ms</td><td>${p.errorRatePct}%</td><td>${fmt(p.peakRps)}</td><td>${p.verdict ?? "—"}</td></tr>`,
      )
      .join("")}
  </tbody></table>`
      : ""
  }

  ${
    r.browser
      ? `<h2>Browser results (p75 per step)</h2><table class="data"><thead><tr><th>Step</th><th>LCP ≤ 2.5 s</th><th>INP ≤ 200 ms</th><th>CLS ≤ 0.1</th><th>FCP ≤ 1.8 s</th><th>TTFB ≤ 0.8 s</th><th>TBT</th></tr></thead><tbody>
    ${r.browser
      .map(
        (s) =>
          `<tr><td>${esc(s.step)}</td>${browserCells(s)
            .map((c) => `<td class="${c.ok ? "" : "bad"}">${c.text}</td>`)
            .join("")}<td class="sub">Not measured (Phase 2)</td></tr>`,
      )
      .join("")}
  </tbody></table>`
      : ""
  }

  ${
    r.journey?.steps.length
      ? `<h2>Journey steps</h2>${
          r.journey.paymentToConfirmationP95Ms === null
            ? ""
            : `<p>Payment → confirmation p95: <span class="${r.journey.paymentToConfirmationP95Ms > PAYMENT_CONFIRMATION_BUDGET_MS ? "bad" : ""}">${(r.journey.paymentToConfirmationP95Ms / 1000).toFixed(2)} s</span> (budget ≤ ${PAYMENT_CONFIRMATION_BUDGET_MS / 1000} s)</p>`
        }<table class="data"><thead><tr><th>Step</th><th>Reached</th><th>Finished</th><th>Dropped</th><th>p95</th></tr></thead><tbody>
    ${r.journey.steps
      .map((s) => `<tr><td>${esc(s.step)}</td><td>${fmt(s.reached)}</td><td>${fmt(s.completed)}</td><td>${fmt(s.reached - s.completed)}</td><td>${s.p95Ms === null ? "—" : `${fmt(s.p95Ms)} ms`}</td></tr>`)
      .join("")}
  </tbody></table>`
      : ""
  }

  <h2>Integrity</h2>
  ${
    r.integrity
      ? `<table class="data"><tbody>${(
          [
            ["Oversold seats", r.integrity.oversoldSeats],
            ["Double charges", r.integrity.doubleCharges],
            ["Charged without a ticket", r.integrity.chargedNoTicket],
          ] as const
        )
          .map(([k, v]) => `<tr><td>${k}</td><td${v ? ' class="bad"' : ""}>${v}</td></tr>`)
          .join("")}</tbody></table>`
      : `<p>Not verified: ${integritySourceFailed(d) ? "the target's read-only source didn't answer." : "this target has no read-only data source yet."}</p>`
  }
  ${
    r.journey?.counts
      ? `<p class="sub">The journey counted ${fmt(r.journey.counts.order)} orders, ${fmt(r.journey.counts.seat)} seats, ${fmt(r.journey.counts.ticket)} tickets and ${fmt(r.journey.counts.charge)} charges, its own view to check against the target's records.</p>`
      : ""
  }

  <h2>Recommended next test</h2>
  <p class="next">${esc(recommendNext(d))}</p>

  <footer>Generated ${esc(when(generatedAt.toISOString()))} by Arbiter Benchmark from the stored run summary. Self-contained: this file needs no network to open or print.</footer>
</main>
</body>
</html>`;
}
