# Performance Audit Platform Feature Breakdown

**Version 0.4** · **Draft for kick-off** · **5 November 2026** · **Internal**

Companion to the [Product Requirements Document](prd.md). This file defines the delivery plan for the 12-week staging MVP and the weeks 13–16 prod-like pilot. Re-estimate the work after the week 2 technical spike.

## Contents

- [Sources and precedence](#sources-and-precedence)
- [Decision log](#decision-log)
- [Scope](#scope)
- [Capacity and timeline](#capacity-and-timeline)
- [Epics and features](#epics-and-features)
- [Release gates](#release-gates)
- [Cut-line](#cut-line)
- [Spike exit criteria](#spike-exit-criteria)
- [Open dependencies](#open-dependencies)
- [Risks](#risks)

## Sources and precedence

| **Document** | **Role** |
| --- | --- |
| `Performance-Audit-Platform-System-Flowchart.html` + `Performance Audit Tool for a High School Sports Ticketing Platform.pdf` | **Source of truth** for stack and architecture |
| `Performance Benchmark Platform Blueprint.docx` | Source for safety controls (4.1, 4.2), data model, reporting checklist (App. B), and release gates |

Items that exist in the Blueprint but not in the PDF were decided one by one (see the [decision log](#decision-log)).

## Decision log

| **ID** | **Topic** | **Decision** |
| --- | --- | --- |
| D1 | Backend | Next.js route handlers (`withAuth` + zod) + Node worker (BullMQ). Business logic lives in `packages/core` |
| D2 | Metrics | Prometheus with native histograms. VictoriaMetrics is not used |
| D3 | Execution | Staging and prod-like: Kubernetes (EKS) + k6 Operator. Local (dev only): with or without Docker. VM agent is dropped |
| D4 | Browser | **k6 browser only**. Lighthouse, Puppeteer, and Playwright are not used in the MVP |
| D5 | Artifacts | S3 (new bucket in AWS), MinIO for local. 90-day retention |
| D6 | Logs | CloudWatch (already available). Pods are labeled with `run_id`. The run page links to Logs Insights |
| D7 | Audit log | Append-only `audit_logs` table in Postgres, 1-year retention. ClickHouse is not used in the MVP |
| D8 | Auth | Microsoft Entra ID (Auth.js). Roles are stored in Postgres, not derived from groups |
| D9 | Team | 2 devs (including the lead, 60-80% coding), 1 shared DevOps (~2 days/week), 1 shared QA (~2 days/week from week 3). There is no Product Owner: business inputs go to the Engineering manager |
| D10 | Target system | Internal application, not live yet. All runs target staging. Lab data only |
| D11 | Scenario | Journey code lives in the repo (`journeys/`). The DB stores a versioned Scenario (journey ref + params + load profile + thresholds). No script editor in the UI |
| D12 | Load presets | Relative to a per-target `reference_peak` (provided by the Engineering manager). Absolute VU/RPS ceilings are enforced in policy. Soak and stress are staging only |
| D13 | Approval | Auto-approve: smoke, baseline, peak on staging. Approval required: spike, stress, soak, and every prod-like run |
| D14 | Approvers | Staging: 1 approver (role `approver`, not the starter). Prod-like: 2 distinct approvers, neither is the starter |
| D15 | Concurrency | Max 1 active run per target, max 2 per namespace. The rest are queued in BullMQ |
| D16 | Notifications | In-app only in the MVP |
| D17 | Report | One self-contained HTML file (static SVG charts, print CSS). “Download PDF” uses browser print. Server-side PDF is Phase 2 |
| D18 | Integrity | Read-only reconciliation adapter. If no data source exists by the end of the spike, it becomes a stretch goal and the verdict carries the caveat “integrity not verified” |
| D19 | Baseline | A run is pinned manually (“Set as baseline”). Release ID is an optional manual field. Nightly baseline and `/version` are Phase 2 |
| D20 | Timeline | 12 weeks for the staging MVP. Pre-launch pilot, final hardening, and runbooks in weeks 13-16 |
| D21 | Roles and sprint capacity | Current planning baseline: Ahwalian = lead and planned non-UI web work; Bayu = current UI implementer and planned execution work. This is not permanent component ownership. The allocation is reviewed every sprint and may change with capacity, priority, dependencies, progress, risk, leave, and review needs. Safety changes should retain an independent reviewer where practical. Capacity must be recalculated after correcting the UI allocation |
| D22 | CI | Bitbucket Pipelines. Load test runs never go through CI. Image registry, tool environments, and deploy path (GitOps) are still open (open dependency 10) |

## Scope

### Staging MVP

The MVP includes a web dashboard to create, approve, run, and stop protocol and browser tests with k6. It provides live and historical metrics, a self-contained HTML report, safety controls, and integrity checks when data is available.

### Ticketing flows measured

| **Flow** | **MVP coverage** |
| --- | --- |
| Find | API + k6 browser (LCP, INP, CLS, FCP, TTFB) |
| Buy | Full checkout journey: latency per step (`group`), payment submit to confirmation, drop-off |
| Receive | Polling for “ticket viewable ≤ 1 minute” through the API. No email/SMS |
| Enter | `scan-ticket` API load: validation latency (≤ 300ms) and scans per minute |

### Phase 2

| **Area** | **Items** |
| --- | --- |
| Browser | TBT and Long Animation Frames, Lighthouse score and report, page weight by type, third-party script time, JS error rate per session (needs a manual listener), INP on SPA route changes, per-step vitals for multi-step flows |
| Mobile | Offline QR, offline scanner sync, battery, startup/ANR/crash |
| Platform | Nightly baseline, `/version` release ID, Teams/Slack, server-side PDF, ClickHouse, live log streaming, inline Logs tab, batch log export to S3, target-internal metrics (APM/DB), RUM, scenario editor |

## Capacity and timeline

- Dev capacity: about 20 dev-weeks over 12 weeks (2 devs, lead at 60-80% coding). The PDF assumed 36.
- Total epic estimate below (dev) is about 20.5 dev-weeks. **There is practically no slack.** The [cut-line](#cut-line) gives a buffer of about 2 dev-weeks and is assumed to be used.
- Current sprint-planning baseline (D21): **Bayu = UI and execution allocation** (current UI implementation plus planned worker, runner image, k6-lib, journeys, state machine and queue, preflight, live loop, and summary work). **Ahwalian = lead and planned non-UI web allocation** (API, auth, approvals, policy engine, and report). This is a capacity plan, not permanent ownership; it is reviewed each sprint and work may move between developers. Safety review (E3.3, E6) should remain independent from the primary implementer where practical.

|  | **Bayu (current plan: UI, execution)** | **Ahwalian (current plan: lead, non-UI web)** |
| --- | --- | --- |
| Epics | E5 (3.0) + E6 (1.5) + E7 (2.5) + E3.4/E3.5, E8.2, E9.1 (1.5) = 8.5 dw | E1 (1.0) + E2 (1.5) + rest of E3 (1.1) + E4 (1.5) + rest of E8 (1.7) + rest of E9 (1.7) = 8.5 dw |
| Share of E0 and E11 | ~1.75 dw | ~1.75 dw |
| **Total** | **~10.25 dw** | **~10.25 dw** |

| **Week** | **Bayu (planned allocation)** | **Ahwalian (planned allocation)** | **DevOps** |
| --- | --- | --- | --- |
| 1-2 | Shared spike (E0) | Shared spike (E0). Go/no-go decision (E0.9) | Namespaces, Operator, NetworkPolicy, ResourceQuota, node pool, Prometheus native histograms, S3 bucket, Fluent Bit to CloudWatch |
| 3-6 | E5 K8s executor, runner image, local executors. E7 k6-lib, `browse-event`, `checkout`. E3.5 state machine and queue | E1 auth and audit. E2 catalog. E3 run lifecycle and policy (create run, manifest, policy engine). Run list/detail | External Secrets, Grafana OSS |
| 7-8 | E6 safety and abort. E5 callbacks, seed/cleanup. E3.4 preflight | E4 approvals and UI. Emergency stop UI. Safety review | Grafana dashboard provisioning, GitOps |
| 9-10 | E7 `receive-poll`, `scan-ticket`, browser journey. E5 artifacts. E8.2 live loop, E9.1 summary job | E8 metrics and live view (query templates, live page, browser results). E9 verdict, baseline | Autoscaling, pod metrics, infra runbook |
| 11-12 | E11 fail-safe tests, number cross-check | E9 HTML report, integrity. E11 | Support for fail-safe tests |
| 13-16 | Pre-launch pilot, hardening, runbooks | Pre-launch pilot, hardening | Prod-like environment |

## Epics and features

Epic estimates are approximate and use developer-weeks (dw). Platform estimates use DevOps developer-weeks (dw-DevOps).

### E0 Foundation and spike

**Delivery** — Bayu + Ahwalian, weeks 1-2, ~2.5 dw

| **ID** | **Feature** | **Acceptance criteria** |
| --- | --- | --- |
| E0.1 | Monorepo skeleton | `apps/web`, `apps/worker`, `apps/agent`, `packages/{core,contracts,k6-lib,config}`, `journeys/`, `infra/` exist. `pnpm build` is green. Bitbucket Pipelines runs only affected apps on pull requests. Web/worker and runner images are built from the same commit and the version is recorded per run |
| E0.2 | Spike: TestRun via Operator | The worker creates a TestRun and runner pods execute k6. TestRun status is readable through the watch API. The Operator cleanup behavior is documented |
| E0.3 | Spike: percentiles | Percentiles from native histograms match the k6 end-of-test summary. k6 metric names and PromQL queries are documented. The native-histogram flag status of our Prometheus version is known |
| E0.4 | Spike: k6 browser | One k6 browser test runs in a runner pod. LCP/CLS/INP/FCP/TTFB appear in Prometheus. The *Stadium 4G* throttle is proven to work. Max browser VUs per pod is measured |
| E0.5 | Spike: NetworkPolicy | Traffic from a runner pod to an unapproved target is blocked |
| E0.6 | Spike: generator calibration | The load capacity of one runner pod (stable VUs and RPS) is measured |
| E0.7 | Spike: payment sandbox | The payment sandbox rate limit is documented |
| E0.8 | Spike: other technical items | SSE through Next.js standalone stays stable on long runs (idle timeouts). The k6 REST API is enabled in the runner for clean stops. Fluent Bit does not drop logs when load nodes are saturated. Staging DB access for integrity exists or not |
| E0.9 | Go/no-go decision | The lead writes a decision at the end of week 2. If any criterion fails: re-plan in week 3 |

### E1 Auth, roles, and audit

**Delivery** — Ahwalian, ~1.0 dw, MVP

| **ID** | **Feature** | **Acceptance criteria** |
| --- | --- | --- |
| E1.1 | Entra ID login | Login through Auth.js. The session carries the user identity |
| E1.2 | `withAuth` wrapper | Every route handler in `app/api/**` is wrapped with `withAuth` and zod parsing. A test fails if any route skips the wrapper. Roles are checked in every handler, not only in middleware |
| E1.3 | Role management | Roles `viewer`, `engineer`, `approver`, `admin` in a Postgres table. `admin` assigns roles through a simple UI. The first admin is seeded through an env var |
| E1.4 | Append-only `audit_logs` | The app DB role has only `INSERT` and `SELECT`. A trigger rejects `UPDATE`/`DELETE`. Monthly partitions. Written in the same transaction as the state change. 1-year retention. Per-row hash chain is a stretch |

### E2 Catalog and configuration

**Delivery** — Ahwalian, ~1.5 dw, MVP

| **ID** | **Feature** | **Acceptance criteria** |
| --- | --- | --- |
| E2.1 | Project, environment, target | Admin can CRUD. A target has an allowlist of hostnames, paths, methods, redirect destinations, and a `reference_peak` |
| E2.2 | Journey catalog | The catalog is synced from the runner image (name, version, parameter schema). It cannot be created from the UI |
| E2.3 | Versioned Scenario | Scenario = journey ref + image version + params + load profile + thresholds. Versions are immutable. A change creates a new version |
| E2.4 | Load presets | Smoke (fixed), baseline, peak, spike (idle to 5-10x within 1 minute), soak (4+ hours), stress. Numbers are relative to `reference_peak`. Supports closed VU and open arrival-rate models |
| E2.5 | Network and device presets | Two presets: *Stadium 4G* and *Wi-Fi baseline*. No custom editor |
| E2.6 | Test-data pool | Identity pool per target. Identities are partitioned per pod, with no duplicates. Pre-run seed and post-run cleanup hooks (HTTP/SQL) are configured per target. Credentials come from External Secrets, never from the run plan |

### E3 Run lifecycle and policy

**Delivery** — Ahwalian + Bayu, ~2.0 dw, MVP

Split (D21): E3.4 and E3.5 (~0.9 dw) are done by Bayu. The rest (~1.1 dw) is Ahwalian.

| **ID** | **Feature** | **Acceptance criteria** |
| --- | --- | --- |
| E3.1 | Create run | Form to pick scenario, target, environment, preset. Optional Release ID field |
| E3.2 | Manifest and hash | The manifest is validated with the shared zod schema. Stored with a SHA-256 hash. Any edit changes the hash |
| E3.3 | Policy engine | Rejects runs that violate: target outside the allowlist, VU/RPS ceiling, duration, ramp rate, run without thresholds. Soak/stress are rejected on prod-like. Checked at create and at Start |
| E3.4 | Preflight | Checks: valid approval, permitted target, window, test-data pool ready, target health endpoint OK, monitoring available, runner capacity |
| E3.5 | State machine and queue | States: draft, pending_approval, approved, queued, starting, running, stopping, completed, failed, aborted, rejected. Max 1 active run per target and 2 per namespace, the rest wait in the queue |
| E3.6 | Run list and detail | Run list with filters. Detail shows manifest, status, approvals, timeline |

### E4 Approvals

**Delivery** — Ahwalian, ~1.5 dw, MVP

| **ID** | **Feature** | **Acceptance criteria** |
| --- | --- | --- |
| E4.1 | Risk classification | Auto-approve for smoke/baseline/peak on staging. Approval required for spike, stress, soak, and every prod-like run |
| E4.2 | Approve and reject | An approval stores the hash it approved. An edit invalidates old approvals |
| E4.3 | Approver rules | Staging: 1 approver. Prod-like: 2 distinct approvers. The starter cannot approve. Enforced on the server |
| E4.4 | Expiry and window | Approvals expire (default 24 hours, configurable). A run can only execute inside the approved window |
| E4.5 | UI and in-app notifications | The approval page shows the immutable plan, max load, duration, window. Badge for pending approvals |

### E5 Execution

**Delivery** — Bayu, ~3.0 dw, MVP

| **ID** | **Feature** | **Acceptance criteria** |
| --- | --- | --- |
| E5.1 | `Executor` interface | Core defines the interface. The implementation is selected per environment |
| E5.2 | `KubernetesExecutor` | Creates, watches, and deletes TestRuns in perf namespaces, with retry when Kubernetes is slow. The service account may only create/read/delete TestRuns |
| E5.3 | Runner image and agent wrapper | The image contains k6, Chromium, and the wrapper. The wrapper fetches the manifest with a short-lived token, recomputes the hash, checks approvals, takes a lease, and runs k6. If any check fails: the pod exits without sending load |
| E5.4 | Two result signals | The worker watches TestRun status, and each pod posts a signed result callback. A run cannot end undetected |
| E5.5 | Local executors (dev only) | Docker mode and non-Docker mode. Hard-blocked from non-local targets. Not available on staging/prod |
| E5.6 | Seed and cleanup hooks | Run before and after the run, results go to the audit log. Cleanup still runs when a run fails or aborts |
| E5.7 | Artifacts to S3 | k6 summary JSON, screenshots, and browser errors are stored in the S3 bucket with 90-day retention. Keys are stored in `run_artifacts`. MinIO for local. Access through presigned URLs, checked per run |
| E5.8 | CloudWatch link | Pods are labeled with `run_id`. The run page has an “Open logs in CloudWatch” link (filtered Logs Insights) |

### E6 Safety and abort

**Delivery** — Bayu, reviewed by Ahwalian as lead, ~1.5 dw, MVP

| **ID** | **Feature** | **Acceptance criteria** |
| --- | --- | --- |
| E6.1 | Lease | Pods renew the lease periodically. The API replies STOP when requested. If the API or dashboard is down, the lease expires and the pod stops k6 by itself |
| E6.2 | Emergency stop | A UI button deletes the TestRun and every pod stops. Restricted to specific roles. Recorded in the audit log |
| E6.3 | Threshold abort | `abortOnFail` (error rate and p95) is mandatory on every run. Policy rejects runs without it |
| E6.4 | Target health probe | The worker probes the target health endpoint every 10 seconds. 3 consecutive failures = abort |
| E6.5 | Fail-closed telemetry | Loss of runner telemetry (Prometheus) = abort |
| E6.6 | Abort reason | Every abort has a structured reason. Stop/abort events from the wrapper go to `audit_logs` through a signed callback, independent of CloudWatch |
| E6.7 | Hard limits | NetworkPolicy and ResourceQuota (owned by DevOps) are proven to hold regardless of app policy |

### E7 Journeys and k6-lib

**Delivery** — Bayu, ~2.5 dw, MVP

| **ID** | **Feature** | **Acceptance criteria** |
| --- | --- | --- |
| E7.1 | `k6-lib` | Modules for auth, checks, thresholds, load profiles. Requests are named (`tags: { name }`) to avoid series cardinality blowup. Every run is tagged `testid=<run_id>`. Dependency-light, bundled with esbuild |
| E7.2 | Log lint rule | Journeys must not log tokens, passwords, or card data. Enforced by lint |
| E7.3 | `browse-event` | Protocol and k6 browser. LCP, INP, CLS, FCP, TTFB measured for the event page |
| E7.4 | `checkout` | Select ticket, cart, checkout, payment, confirmation. Latency per step (`group`) and payment submit to confirmation. A retry after a dropped connection does not charge twice (idempotent). Drop-off per step |
| E7.5 | `receive-poll` | Polls until the ticket is viewable. Time from purchase to ticket appearing in the account. Pass if ≤ 1 minute |
| E7.6 | `scan-ticket` | Validation latency (target ≤ 300ms) and scans per minute per gate |
| E7.7 | Integrity counters | Journeys emit order, seat, ticket, and charge counters used by the integrity adapter |
| E7.8 | Default budgets | PDF budgets as defaults per target: LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1, FCP ≤ 1.8s, TTFB ≤ 0.8s, API p95 ≤ 500ms, payment p95 ≤ 3s, scan ≤ 300ms, QR ≤ 1s. Overridable per target |

### E8 Metrics and live view

**Delivery** — Ahwalian + Bayu, ~2.0 dw, MVP

Split (D21): E8.2 live loop (~0.3 dw) is done by Bayu. The rest (~1.7 dw) is Ahwalian.

| **ID** | **Feature** | **Acceptance criteria** |
| --- | --- | --- |
| E8.1 | Query templates | PromQL templates in `packages/core`. The browser never sends PromQL. Access is checked per run |
| E8.2 | Live loop | The worker runs one 5-second loop per active run, publishes to Redis, and an SSE route handler forwards it. 20 viewers still means one loop |
| E8.3 | Live run page | VUs, RPS, p95/p99, error rate, threshold lines, time remaining, emergency stop button |
| E8.4 | Browser results | LCP, INP, CLS, FCP, TTFB per journey. TBT is shown as “not measured (Phase 2)” |
| E8.5 | Open in Grafana | Link with `var-testid` and the run time range. Grafana covers per-endpoint breakdown, generator health, heatmaps, run vs run |

### E9 Results, integrity, and report

**Delivery** — Ahwalian + Bayu, ~2.0 dw, MVP

Split (D21): E9.1 summary job (~0.3 dw) is done by Bayu. The rest (~1.7 dw) is Ahwalian.

| **ID** | **Feature** | **Acceptance criteria** |
| --- | --- | --- |
| E9.1 | End-of-run summary | A job saves p50/p95/p99, error rate, peak RPS, max VUs, intended vs achieved load to Postgres. Survives metrics retention |
| E9.2 | Verdict | Pass/fail based on thresholds, with caveats (measurement gap, integrity not verified, generator saturated) |
| E9.3 | Integrity adapter | Read-only queries: orders vs seats vs payments vs tickets. Counts oversold, double charge, charged-no-ticket. If no data source exists: the verdict carries the caveat “integrity not verified”. **Stretch if there is no access by week 2** |
| E9.4 | Baseline | “Set as baseline” button. Run vs baseline comparison (p95, error rate, peak RPS) |
| E9.5 | Run history | Filter by target, scenario, release ID, result |
| E9.6 | HTML report | One self-contained HTML file (inline CSS, static SVG charts). A4 print CSS. Content follows Blueprint Appendix B: scenario and version, target, window, approvals, intended vs achieved load, p50/p95/p99, errors, baseline comparison, verdict, caveats, recommendations. Stored in S3, opened through a presigned URL, “Download PDF” via print |
| E9.7 | Release trend chart | Trend of p95, error rate, peak RPS per release. **Cut-line 1** |

### E10 Platform

**Delivery** — DevOps, ~4-5 dw-DevOps

| **ID** | **Feature** | **Acceptance criteria** |
| --- | --- | --- |
| E10.1 | EKS and node pool | Dedicated load node pool with an autoscaler (Karpenter or Cluster Autoscaler) |
| E10.2 | k6 Operator and namespaces | `perf-staging`, `perf-prod`. Operator installed and its version verified against our k6 version |
| E10.3 | Guardrails | NetworkPolicy (egress only to approved targets) and ResourceQuota (pod, CPU, memory caps) |
| E10.4 | Prometheus | Remote-write receiver and native histograms enabled. 90-day retention. Runner pod CPU/memory metrics scraped |
| E10.5 | Grafana OSS | Entra SSO, the official k6 native-histogram dashboard and a runner-pod health dashboard, provisioned through GitOps |
| E10.6 | Secrets | Vault or External Secrets Operator into perf namespaces |
| E10.7 | S3 and CloudWatch | New bucket with a 90-day lifecycle. Fluent Bit ships perf namespace logs to CloudWatch, 90-day retention |
| E10.8 | GitOps | Operator, namespaces, policies, quotas are versioned and reviewed (Argo CD) |

### E11 Hardening and pilot

**Delivery** — Bayu + Ahwalian, ~1.0 dw in weeks 11-12, pilot in weeks 13-16

| **ID** | **Feature** | **Acceptance criteria** |
| --- | --- | --- |
| E11.1 | Fail-safe test matrix | A run stops safely when the dashboard is down, the web app is down, the worker is down, one pod dies, and telemetry is lost. Documented with evidence |
| E11.2 | Measurement validation | Dashboard and Grafana numbers match the k6 summary |
| E11.3 | Guardrail validation | NetworkPolicy blocks an unapproved target |
| E11.4 | Runbooks | How to run, stop, troubleshoot, and emergency contacts |
| E11.5 | Pre-launch pilot (weeks 13-16) | Low-volume run on the prod-like environment with the full approval flow (2 approvers) |

## Release gates

These gates revise the Blueprint.

1.  **Execution correctness**: a run produces load matching the manifest, and results and metrics are recorded.
2.  **Policy enforcement**: ceilings, allowlist, approvals, and hash invalidation are proven.
3.  **Fail-safe abort**: proven when the control plane, a pod, and telemetry fail.
4.  **Measurement validity**: tool numbers match the k6 summary, intended vs achieved load is reported.
5.  **Pre-launch pilot** (weeks 13-16): low-volume run on a prod-like environment with the full approval flow. A 50,000-VU test on prod is not a gate.

## Cut-line

Defer these items in order if the schedule slips.

1.  E9.7 Release trend chart (the simple baseline comparison stays)
2.  Soak preset
3.  Local mode without Docker (Docker mode stays)
4.  E9.3 Integrity check, if there is no data source

Keep safety controls, approvals, emergency stop, leases, the HTML report, and the verdict in scope.

## Spike exit criteria

Proceed only when all six criteria are met.

1.  A TestRun runs through the k6 Operator.
2.  Percentiles from native histograms match the k6 summary.
3.  One k6 browser test runs in a runner pod, vitals appear in Prometheus, the *Stadium 4G* throttle works, and max browser VUs per pod is measured.
4.  NetworkPolicy blocks an unapproved target.
5.  Generator calibration: the capacity of one runner pod is measured.
6.  The payment sandbox rate limit is verified.

If any criterion fails, Ahwalian documents the decision and replans in week 3.

## Open dependencies

| **ID** | **Dependency** | **Proposed owner** | **Needed before** |
| --- | --- | --- | --- |
| 1 | Names of the SRE and the ticketing owner (prod-like approvers) | Engineering manager | Week 7 |
| 2 | `reference_peak` projection per target | Engineering manager | Week 2 |
| 3 | Default ceiling values (max VU/RPS, duration, ramp) per environment | Engineering manager + DevOps | Week 3 |
| 4 | Target health endpoint, and read-only staging DB access for integrity | Ticketing team dev | Week 3 (health), week 2 (DB access) |
| 5 | Test identities, payment sandbox, inventory reset (built by us). No dw estimate yet, to be added after the spike | Bayu | Weeks 3-4 |
| 6 | EKS node pool, k6 Operator, Prometheus native histograms, Fluent Bit to CloudWatch, S3 bucket | DevOps | Weeks 1-2 |
| 7 | Prod-like environment for the pre-launch pilot | Engineering manager + DevOps | Week 12 |
| 8 | DevOps (~2 days/week) and QA (~2 days/week, from week 3) allocation | Engineering manager | Week 1 |
| 9 | Confirm Ahwalian as lead (D21) | Engineering manager | Week 1 |
| 10 | Container image registry and pipeline credentials (Bitbucket Pipelines to registry, and image version update to the GitOps repo) | DevOps | Week 2 |

## Risks

| **Risk** | **Mitigation** |
| --- | --- |
| Dev capacity ~20 dw with no slack | Explicit cut-line. Re-estimate after the spike |
| Shared DevOps (~2 days/week) becomes a bottleneck in weeks 1-2 | Send the infra needs list before kick-off. Schedule cluster-dependent spike items first |
| Chromium in the runner image: large image and heavy browser VUs | Cap browser VUs per pod (number from the spike), run alongside protocol VUs |
| Wrong percentiles because of histograms | Spike E0.3 and validation E11.2 |
| SSE through Next.js standalone drops on long runs | Verified in the spike. Fallback to polling |
| Fluent Bit drops logs when load nodes are saturated | Verified in the spike. Abort reasons stay in `audit_logs` |
| Integrity cannot be proven without a data source | Pluggable adapter, verdict caveat, stretch in the cut-line |
| Staging is not representative of production | Document differences, add caveats to conclusions |
| Payment sandbox rate limit | Verified in the spike, presets adjusted |
| Prod-like environment does not exist at pilot time | Open dependency 7, discussed by week 8 at the latest |
| Next.js upgrades touch the API | Pin versions, upgrade deliberately |
