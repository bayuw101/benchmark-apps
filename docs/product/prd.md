# Performance Audit Platform Product Requirements Document

The Performance Audit Platform lets engineers test the internal sports ticketing system before launch. It governs how teams configure, approve, execute, and stop k6 tests and how they use the results to assess performance and correctness.

The [feature breakdown](feature-breakdown.md) covers delivery scope, decisions, owners, and release gates.

## Contents

- [Document status](#document-status)
- [Revision history](#revision-history)
- [Review and approval](#review-and-approval)
- [Sources and conventions](#sources-and-conventions)
- [Problem statement](#problem-statement)
- [Solution](#solution)
- [Success metrics](#success-metrics)
- [Non-functional requirements](#non-functional-requirements)
- [User stories](#user-stories)
- [Implementation decisions](#implementation-decisions)
- [Testing decisions](#testing-decisions)
- [Non-goals](#non-goals)
- [Open questions and TBD register](#open-questions-and-tbd-register)
- [Ownership and scope notes](#ownership-and-scope-notes)
- [Glossary](#glossary)

## Document status

| **Document** | Product Requirements Document |
| --- | --- |
| **Version** | 0.5 |
| **Status** | Draft for kick-off |
| **Date** | 9 November 2026 |
| **Lead** | Ahwalian (pending Engineering manager confirmation, decision D21) |
| **Classification** | Internal |
| **Related documents** | Performance Benchmark Platform Blueprint; Performance Audit Platform system flowchart and report |

## Revision history

| **Version** | **Date** | **Change summary** |
| --- | --- | --- |
| 0.1 | 4 November 2026 | Initial feature breakdown (decisions D1-D20) and draft PRD |
| 0.2 | 4 November 2026 | Added D21 (lead and role split, workload table), D22 (CI on Bitbucket Pipelines), open dependency 10 |
| 0.3 | 4 November 2026 | PRD and Feature Breakdown consolidated into one document |
| 0.4 | 5 November 2026 | Removed the Product Owner role. Business inputs and related open dependencies are owned by the Engineering manager |
| 0.5 | 9 November 2026 | Corrected the current planning baseline: Bayu is implementing the UI. Bayu/Ahwalian assignments remain provisional and are reviewed each sprint against capacity, priority, dependencies, risk, and progress |

## Review and approval

| **Role** | **Name** | **Decision** | **Date** |
| --- | --- | --- | --- |
| Engineering manager | TBD |  |  |
| Lead | Ahwalian |  |  |
| DevOps | TBD |  |  |
| QA | TBD |  |  |

## Sources and conventions

The `Performance Benchmark Platform Blueprint.docx` provides the safety controls, data model, reporting checklist, and release gates. The `Performance Audit Tool for a High School Sports Ticketing Platform.pdf` and `Performance-Audit-Platform-System-Flowchart.html` are the sources of truth for the stack and architecture. See the [decision log](feature-breakdown.md#decision-log) for D1–D22.

**TBD** marks an open item. The register identifies its owner and proposed default where available. Figures marked “proposed” are pending agreement. Other figures come from the source documents or recorded decisions.

## Problem statement

The team is about to launch an internal high school sports ticketing platform. It has no way to prove that the platform will hold up on game day. Fans arrive in short, sharp spikes (right before kickoff and when tickets go on sale), mostly on phones with weak stadium signal.

From the engineer’s point of view:

- There is no repeatable, approved way to run load tests against the four flows that matter: find the event, buy, receive the ticket, and get through the gate.
- There is no safety net. A badly configured test can hit the wrong target, exceed capacity, or keep running when nobody is watching.
- There is no way to show correctness under load (oversold seats, double charges, charged-but-no-ticket orders). Zero of each is the pass/fail rule.
- Results are not comparable between releases, so a slow release is noticed late.

The application is not live yet, so only lab data exists. There is no production traffic history to size load from.

## Solution

An internal web platform where engineers create, approve, run, and stop k6 load and browser tests against registered targets, and where everyone can see live and historical results and a clear verdict.

From the user’s perspective:

- An engineer picks a versioned scenario (a journey plus load profile and thresholds), a target, and a preset, and the platform validates it against policy before anything runs.
- Low-risk runs on staging start automatically. Spike, stress, soak, and every prod-like run need approval from other people, and any edit invalidates earlier approvals.
- Runs execute on Kubernetes through the k6 Operator. Every runner pod re-verifies the approved plan before sending load. A run can always be stopped: by an emergency stop button, by an expired lease if the platform is down, by thresholds, by target health checks, and by loss of telemetry.
- While a run is active, the dashboard shows live VUs, RPS, p95/p99, error rate, and time remaining. After the run, it shows a verdict, browser results, correctness counts when data is available, a baseline comparison, and a self-contained HTML report that can be saved as PDF.
- Grafana OSS handles deep dives. The platform links to it with the run pre-filtered.

MVP scope is the staging MVP in 12 working weeks. A pre-launch pilot on a prod-like environment, final hardening, and runbooks follow in weeks 13-16.

## Success metrics

| **ID** | **Metric** | **Target** |
| --- | --- | --- |
| S1 | Release gate 1, execution correctness | A run produces load matching its manifest. Achieved vs intended load is reported on every run |
| S2 | Release gate 2, policy enforcement | 100% of policy-violating manifests in the policy test suite are rejected. 0 runs start without an approval matching the current manifest hash |
| S3 | Release gate 3, fail-safe abort | 5 of 5 failure scenarios stop load: dashboard down, web app down, worker down, one runner pod down, telemetry lost. Max time to stop load: TBD (proposed ≤ 60 s after the failure is detectable) |
| S4 | Release gate 4, measurement validity | Platform and Grafana percentiles match the k6 end-of-test summary within TBD (proposed ±5%) on at least 3 reference runs |
| S5 | Release gate 5, pre-launch pilot | At least 1 low-volume run on the prod-like environment with the full 2-approver flow (weeks 13-16) |
| S6 | Delivery | Staging MVP accepted in 12 working weeks from kick-off date (TBD) |
| S7 | Threshold discipline | 100% of runs have thresholds and an abort rule. The platform refuses to start a run without them |
| S8 | Auth coverage | 100% of API routes are wrapped by the shared auth wrapper, enforced by an automated test |
| S9 | Correctness under load | Oversold seats = 0, double charges = 0, charged-without-ticket = 0 on the pilot runs, or the verdict explicitly says “integrity not verified” |

## Non-functional requirements

| **ID** | **Requirement** | **Target** |
| --- | --- | --- |
| N1 | Live update cadence | Live metrics refresh every 5 s, from one query loop per active run regardless of viewer count (20 viewers, one loop) |
| N2 | Health probe | Target health endpoint probed every 10 s. 3 consecutive failures abort the run (worst-case detection about 30 s) |
| N3 | Concurrency | Max 1 active run per target and 2 per namespace. Further runs wait in a queue |
| N4 | Approval validity | Approvals expire after 24 h by default (proposed, configurable) and are valid only inside the approved window |
| N5 | Emergency stop | All runner pods terminated within TBD (proposed ≤ 30 s) of the stop action. The action is audit-logged |
| N6 | Lease | Lease TTL and renewal interval: TBD (set from the spike). Expiry stops k6 without any control-plane connectivity |
| N7 | Percentile accuracy | Percentiles are computed from native histograms across all runner pods. Tolerance vs k6 summary: TBD (proposed ±5%) |
| N8 | Retention | Metrics 90 days. Audit log 1 year. Run summaries kept indefinitely. Artifacts and reports: TBD (proposed: reports and summary JSON 1 year, screenshots and raw artifacts 90 days) |
| N9 | Report generation | HTML report available within TBD (proposed ≤ 30 s) of run completion |
| N10 | Security | Roles checked inside every handler (never middleware alone). Secrets (test accounts, payment sandbox keys) never appear in run plans, logs, or reports |
| N11 | Journey scale | Max VUs per runner pod and max browser VUs per pod: TBD (measured in the spike). Absolute VU/RPS ceilings per environment: TBD (Engineering manager + DevOps) |
| N12 | Platform availability | TBD (internal tool, proposed business-hours best effort). The safety path must not depend on platform availability |
| N13 | Browser metric coverage | LCP, INP, CLS, FCP, TTFB measured. TBT shown as “not measured (Phase 2)”, never blank |

### Default product budgets

Targets can override these defaults from the source documents.

| **Flow** | **Metric** | **Budget** |
| --- | --- | --- |
| Find | LCP / INP / CLS / FCP / TTFB | ≤ 2.5 s / ≤ 200 ms / ≤ 0.1 / ≤ 1.8 s / ≤ 0.8 s (p75 for field-style values) |
| Buy | Each API call p95 | ≤ 500 ms |
| Buy | Payment submit to confirmation p95 | ≤ 3 s |
| Receive | Purchase to ticket viewable | ≤ 1 minute |
| Enter | Scan validation | ≤ 300 ms |
| Correctness | Oversold seats, double charges, charged-without-ticket | 0 |

## User stories

The bullets under each numbered story are its acceptance criteria. Stories marked \[Stretch\] or \[TBD\] depend on an open item.

### Run setup

1. As an engineer, I want to create a run by choosing a scenario, a target, an environment, and a load preset, so that I can test a flow without writing infrastructure code.
    - A run cannot be saved without scenario, target, environment, and preset.
    - A saved run stores an immutable manifest and its SHA-256 hash.
    - Changing any manifest field produces a different hash.
2. As an engineer, I want load presets (smoke, baseline, peak, spike, soak, stress) expressed relative to a target’s reference peak, so that I can size load without historical sales data.
    - Each preset maps to a documented load shape: spike goes from idle to 5-10x within 1 minute, soak lasts 4 hours or more.
    - Changing a target’s reference peak changes the computed load of relative presets, and absolute ceilings still apply.
    - Presets support both closed (VU) and open (arrival-rate) models.
3. As an engineer, I want the platform to tell me exactly why a run was rejected, so that I can fix the plan without guessing.
    - A rejection lists every violated rule (target not allowed, VU/RPS ceiling, duration, ramp rate, missing thresholds, soak/stress on prod-like).
    - Policy is checked at creation and again at Start.
4. As an engineer, I want to see queue position and why a run is waiting, so that I know when it will start.
    - A run waiting on the per-target or per-namespace limit shows “queued” with the blocking run.
    - A queued run starts automatically when the limit frees up and approvals are still valid.
5. As an engineer, I want to record an optional Release ID on a run, so that results can be compared between releases.
    - The Release ID is stored on the run and shown in history and reports.
    - Leaving it empty never blocks a run.
6. As an engineer, I want a *Stadium 4G* network preset and a *Wi-Fi baseline* preset for browser steps, so that I measure realistic phone conditions.
    - The Stadium 4G preset applies network and CPU throttling to browser VUs. Verified in the spike (TBD profile values).
    - Both presets are selectable. There is no custom profile editor in the MVP.
7. As an engineer, I want a preflight check before a run starts, so that I do not start a run that is certain to fail.
    - Preflight verifies valid approval, permitted target, inside window, test-data pool ready, target health endpoint OK, monitoring available, and runner capacity.
    - Any failed check blocks the start and names the failed check.

### Approvals

8. As an engineer, I want low-risk runs on staging (smoke, baseline, peak) to be auto-approved, so that routine checks are not slowed down.
    - A smoke, baseline, or peak run on staging within ceilings starts without a human approver.
    - The auto-approval is recorded in the audit log with the rule that applied.
9. As an approver, I want to review the exact plan (target, max load, duration, window, thresholds) before approving a spike, stress, or soak run on staging, so that I know what I am authorizing.
    - One approver with the `approver` role who is not the starter is required.
    - The approval screen shows the immutable manifest and hash.
10. As an SRE or ticketing owner, I want prod-like runs to require two different approvers, neither of them the starter, so that no one person can authorize production-impacting load.
    - The platform rejects a second approval from the same user or from the starter, on the server.
    - Both approvers’ identities are in the audit log. Named SRE and ticketing owner: TBD (Engineering manager, before week 7).
11. As an approver, I want edits to a run to invalidate earlier approvals, so that nothing runs that I did not approve.
    - Editing an approved run changes its hash, and all earlier approvals stop counting.
    - The Start action refuses a run whose current hash has no valid approvals.
12. As an approver, I want approvals to expire and to cover only a time window, so that stale approvals cannot be used later.
    - An approval older than the validity period (default 24 h, proposed) is rejected at Start.
    - A run cannot start outside its approved window.
13. As an approver, I want to see pending approvals in the app, so that I do not rely on chat messages.
    - A badge shows the count of runs waiting for my approval.
    - In-app notification only. Teams/Slack are out of the MVP.

### Execution and safety

14. As a runner pod, I need to verify the run before sending any load, so that a bug in the web app cannot cause an unapproved run.
    - The pod fetches the manifest with a short-lived token, recomputes the hash, checks approvals, and takes a lease before k6 starts.
    - If any check fails, the pod exits and zero requests are sent to the target.
15. As an engineer, I want runs to execute on Kubernetes through the k6 Operator with load split across pods, so that I can generate more load than one machine can.
    - Each run creates one TestRun in the correct namespace with the runner image, script, and run ID.
    - Creation retries when Kubernetes is slow. The app’s service account can only create, read, and delete TestRuns.
    - Intended vs achieved arrival rate and dropped iterations are reported per run.
16. As an engineer, I want an emergency stop button, so that I can stop load immediately.
    - Pressing it deletes the TestRun and the API replies STOP to lease renewals.
    - All runner pods terminate within TBD (proposed ≤ 30 s). The action is audit-logged with the user.
17. As a platform owner, I want load to stop on its own when the control plane is unreachable, so that a platform outage never leaves load running unattended.
    - With the web app and API down, every pod stops k6 when its lease expires.
    - Verified in the fail-safe test matrix.
18. As an engineer, I want threshold-based abort on every run, so that a failing target is not hammered to the end.
    - Every run has error-rate and p95 thresholds with abort-on-fail. The platform refuses a run without them.
    - The abort reason is stored on the run.
19. As an engineer, I want the target’s health endpoint probed during a run, so that load stops when the target is unhealthy.
    - Probe every 10 s. 3 consecutive failures abort the run.
    - The abort reason says “target health probe failed”.
20. As an SRE, I want the run to abort when telemetry goes missing, so that we never run blind.
    - Loss of runner telemetry in the metrics store aborts the run (fail closed).
    - The abort reason says “telemetry lost”.
21. As an SRE, I want network and size limits the app cannot override, so that a policy bug cannot send traffic to the wrong place.
    - Runner pods can reach only approved targets (plus the minimum control-plane and metrics endpoints, see TBD-3). An unapproved target is blocked in a test.
    - Namespace quotas cap total pods, CPU, and memory.
22. As an auditor, I want every abort to have a structured reason, so that I can explain why a run stopped.
    - Reasons include emergency stop, lease expired, threshold, target health, telemetry lost, policy breach, and Kubernetes failure.
    - Stop and abort events from the wrapper reach the audit log through a signed callback, independent of the logging service.
23. As an engineer, I want the platform to detect a run ending even if one signal fails, so that no run silently disappears.
    - The worker watches TestRun status, and each pod posts a signed result callback. A run is only “unknown” if both signals are missing.

### Journeys and test data

24. As an engineer, I want a Find journey that measures the event page in a real browser, so that I know how fans on phones experience it.
    - LCP, INP, CLS, FCP, and TTFB are recorded for the event page and stored per run.
    - Results are compared against the budgets and shown pass/fail.
25. As an engineer, I want a Buy journey (select ticket, cart, checkout, payment, confirmation) with timing per step, so that I can see which step is slow.
    - Latency for each step is recorded under its own group. Payment submit to confirmation p95 is reported.
    - Requests are named, so URLs with IDs do not create unbounded metric series.
    - A connection drop mid-payment followed by a retry never creates a second charge (verified by the integrity counters).
26. As an engineer, I want a Receive journey that polls until the ticket is viewable, so that I know how long fans wait for their ticket.
    - The time from purchase to ticket viewable is recorded. Pass when ≤ 1 minute.
    - No email or SMS is sent or measured in the MVP.
27. As an engineer, I want a scan journey that loads the validation API, so that I know whether gates will keep up.
    - Validation latency (budget ≤ 300 ms) and scans per minute per gate are recorded.
    - Offline scanning and the scanner app are not measured.
28. As an engineer, I want a pool of test identities partitioned per runner pod, so that pods never reuse the same identity.
    - No identity is assigned to two pods in the same run, verified by a test.
    - Credentials come from the secrets store, never from run plans. Provisioning of identities and inventory reset: TBD (Bayu, weeks 3-4, no dev-week estimate yet, to be added after the spike).
29. As an engineer, I want seed and cleanup steps around a run, so that runs are repeatable and integrity counts are valid.
    - Pre-run seed and post-run cleanup execute and their results are audit-logged.
    - Cleanup still runs when the run fails or is aborted.
    - \[TBD\] Hook security model (named hooks vs free-text SQL): see TBD-6.
30. As a journey author, I want a shared library and a lint rule, so that journeys follow the same conventions and never leak secrets.
    - Journeys use shared modules for auth, checks, thresholds, and load profiles. Each run is tagged with its run ID.
    - Lint fails the build when a journey logs a token, password, or card data.

### Results, live view, and reports

31. As an engineer, I want a live view of an active run, so that I can watch it and stop it if needed.
    - Shows VUs, RPS, p95, p99, error rate, threshold lines, time remaining, and the stop button.
    - Updates every 5 s. Twenty viewers cause one query loop per run.
32. As an engineer, I want browser results per journey on the run page, so that I see LCP, INP, CLS, FCP, and TTFB next to load results.
    - TBT is displayed as “not measured (Phase 2)”.
    - The browser never sends raw PromQL. Only approved query templates run on the server.
33. As an engineer, I want to open Grafana from a run with filters already applied, so that I can investigate without copying IDs.
    - The link includes the run ID and the run’s start and end time.
    - Grafana shows per-endpoint breakdown, generator health, heatmaps, and run vs run.
34. As an engineer, I want a verdict for each run, so that I know pass or fail at a glance.
    - The verdict is derived from thresholds and carries caveats (measurement gap, generator saturated, integrity not verified).
    - p50, p95, p99, error rate, peak RPS, max VUs, and intended vs achieved load are saved to the database and survive metrics retention.
35. As a QA engineer or the lead, I want oversold, double-charge, and charged-without-ticket counts in the result, so that I can confirm the zero-defect rule.
    - Counts come from a read-only reconciliation of orders, seats, payments, and tickets.
    - If no data source exists, the verdict says “integrity not verified”. \[Stretch, decided at the end of the spike\]
36. As an engineer, I want to pin a run as the baseline and compare later runs to it, so that I can spot regressions.
    - “Set as baseline” is available to engineer and above.
    - The comparison shows p95, error rate, and peak RPS deltas.
37. As an engineer, I want a run history I can filter, so that I can find past results.
    - Filter by target, scenario, release ID, and result.
    - Results remain visible after metrics retention expires.
38. As an engineering manager, I want a self-contained report for each run, so that I can share results.
    - One HTML file with inline CSS and static SVG charts. A4 print stylesheet. “Download PDF” works through browser print.
    - Content follows the reporting checklist: scenario and version, target and environment, window, approvals, intended vs achieved load, p50/p95/p99, errors, baseline comparison, verdict, caveats, recommended next test.
    - Generated within TBD (proposed ≤ 30 s) of run completion.
39. As an engineer, I want access to artifacts and logs from the run page, so that I can debug a failed run.
    - Summary JSON, screenshots, and browser errors are downloadable through short-lived links checked per run.
    - The run page links to the run’s logs in CloudWatch. Access for engineers and approvers: TBD (see TBD-9).

### Administration and identity

40. As an admin, I want to manage projects, environments, and targets with an allowlist, so that tests can only hit approved places.
    - A target holds allowed hostnames, paths, methods, redirect destinations, and a reference peak.
    - A request outside the allowlist is rejected by policy and blocked by the network layer.
41. As an engineer, I want to pick journeys from a catalog and save scenarios as versions, so that results are comparable.
    - The catalog is synced from the runner image and cannot be edited in the UI.
    - A scenario version is immutable. Any change creates a new version. The image version is recorded on every run.
42. As a user, I want to sign in with my company account, so that I do not manage another password.
    - Login through Microsoft Entra ID. App registrations for the web app and Grafana: TBD (see TBD-9).
43. As an admin, I want to assign the roles viewer, engineer, approver, and admin, so that access matches responsibility.
    - Roles are stored in the platform database, not derived from groups. The first admin is seeded from configuration.
    - Viewer can read. Engineer can create and start runs (subject to approval). Approver can approve. Admin can manage targets and roles.
44. As an auditor, I want an append-only audit log, so that I can trust the history of approvals and actions.
    - Approvals, edits, starts, stops, aborts, hook runs, and role changes are logged in the same transaction as the change.
    - The application database role cannot update or delete audit rows. Retention 1 year.

### Development, platform, and quality

45. As a developer, I want to run tests locally with or without containers, so that I can iterate quickly.
    - Local execution is blocked for any non-local target, and unavailable on staging and prod-like environments.
    - Both modes produce the same run record format. Non-Docker mode is cut-line item 3.
46. As a developer, I want a mock target service, so that I can test abort, policy, and integrity without touching staging. \[TBD, see TBD-4\]
    - The mock supports configurable latency and errors, a health endpoint, and an intentional oversell mode.
    - Integration tests run against it in CI.
47. As a DevOps engineer, I want a clear list of infrastructure needed from week 1, so that the spike is not blocked.
    - Namespaces, k6 Operator, network and quota rules, load node pool, metrics store with native histograms and remote-write, bucket, and log shipping are available by the end of week 2.
    - The Operator version is verified against the k6 version in use.
48. As a QA engineer, I want to validate that the platform’s numbers match k6’s own summary, so that results can be trusted.
    - At least 3 reference runs show platform and Grafana percentiles within tolerance (TBD, proposed ±5%) of the k6 summary.
    - QA role and deliverables: TBD (see TBD-7).
49. As the lead, I want a written go/no-go at the end of the spike, so that scope is re-planned early if something fails.
    - The decision is written by the lead (Ahwalian) by the end of week 2.
    - Go requires: TestRun runs through the Operator, percentiles match, a k6 browser test runs in a pod with vitals in the metrics store and the throttle working, the network policy blocks an unapproved target, generator calibration is measured, and the payment sandbox rate limit is verified.
    - If any item fails, a written re-plan is produced in week 3.
50. As the engineering manager, I want a pre-launch pilot with the full approval flow, so that we are confident before go-live.
    - At least 1 low-volume run on the prod-like environment with 2 distinct approvers (weeks 13-16).
    - Prod-like environment availability: TBD (Engineering manager + DevOps, week 12).

## Implementation decisions

### Architecture

- One web application serves both the dashboard and the API through route handlers. A separate always-running worker process handles background work. A shared core library holds all business logic and is used by both. A shared contracts library holds the manifest schema, summary types, and enums.
- Route handlers stay thin: parse, authorize, call the core library. Every handler is wrapped by one auth wrapper that also parses input. Roles are checked in the handler, not only in middleware.
- Load runs on Kubernetes through the k6 Operator on a dedicated autoscaled node pool in EKS. Tests never run inside the web app.
- The web app and worker are self-hosted Node processes (not serverless), sharing one image with different start commands.
- Metrics: plain Prometheus with native histograms and remote-write. Our dashboard and Grafana OSS both read it. The browser never sends raw queries; the server runs approved query templates after checking per-run access.
- Live updates: the worker runs one query loop per active run, publishes to Redis, and the web app forwards updates to viewers over a server-sent stream.
- Browser measurement uses k6 browser only. The runner image therefore contains Chromium.
- Stack decisions already made: Next.js with TypeScript, Node worker with BullMQ and Redis, PostgreSQL, Recharts or ECharts for charts, Entra ID through Auth.js, S3-compatible storage (MinIO locally), CloudWatch for logs.

### Modules

- Web app: pages for run setup, approvals, live status, charts, reports, history, admin. Route handlers for auth, manifest validation, policy checks, approvals, emergency stop, lease renewal, pod callbacks, metric queries, and the live stream.
- Worker: creates and watches TestRuns, runs the live metrics loop, builds end-of-run summaries and reports, collects results.
- Agent wrapper (runner image entrypoint): verifies hash and approvals, holds the lease, stops k6 cleanly through the k6 local API (or kills it), and posts signed callbacks.
- Core library: policy, manifest and hashing, approvals, lease rules, Kubernetes client, query templates, database client.
- k6 library and journeys: shared auth, checks, thresholds, load profiles. Journeys for browse-event, checkout, receive-poll, scan-ticket.
- Executor interface with three implementations: Kubernetes (staging and prod-like), local Docker, local without Docker (dev only, hard-blocked from non-local targets).
- Integrity adapter: pluggable, read-only reconciliation.
- Mock target and local stack: TBD (TBD-4).

### Run states

Draft, pending approval, approved, queued, starting, running, stopping, completed, failed, aborted, rejected.

### Data model

Projects, environments, targets (with allowlist and reference peak), journey catalog entries, scenarios and scenario versions, load presets, runs (immutable manifest and hash), approvals (with the hash approved), run summaries, baselines, run artifacts, audit log, test-data pools, hooks (TBD-6), roles.

### Run lifecycle contracts

- Create: check role, validate manifest against the shared schema, check policy (allowed targets, VU/RPS ceilings, duration, ramp rate, thresholds present), store with SHA-256 hash.
- Approve: store the hash approved. Any edit changes the hash and invalidates earlier approvals. Starter cannot approve. Prod-like requires two distinct approvers.
- Start: re-check policy and approvals, queue a job. Worker creates the TestRun.
- Pod verification: short-lived token to fetch the manifest, recompute the hash, check approvals, take a lease. On any failure the pod exits and sends no load.
- Lease renewal: API replies continue or STOP. If the API is unreachable, the lease expires and the pod stops k6.
- Stop: emergency stop deletes the TestRun and makes the API reply STOP.
- Result: signed callback from each pod plus the worker’s TestRun status watch.
- Policy limits that the app cannot override: namespace network policy and resource quota.

### Policy decisions

- Environments: staging and prod-like are separate namespaces and policies. All runs target staging until a prod-like environment exists. Soak and stress are staging only.
- Approval rules: auto for smoke, baseline, peak on staging. Required for spike, stress, soak, and every prod-like run. Staging: 1 approver. Prod-like: 2 distinct approvers, neither is the starter.
- Concurrency: 1 active run per target, 2 per namespace, rest queued.
- Load presets are relative to the target’s reference peak. Absolute ceilings live in policy.
- Auto-abort signals in the MVP: threshold abort, target health probe, loss of runner telemetry, lease expiry, emergency stop.

### Storage and retention

- Audit log in PostgreSQL, append-only, 1-year retention.
- Artifacts in S3 (new bucket). Logs in CloudWatch with pods labeled by run ID.
- Report: one self-contained HTML file, stored in S3. PDF through browser print.

### Deployment and tooling

- Monorepo with a package manager workspace and a build orchestrator. One Docker image per app plus the runner image, built from the same commit and recorded on every run.
- GitOps for the operator, namespaces, policies, and quotas. Secrets through a secrets operator.
- CI runs on Bitbucket Pipelines: tests only the affected apps on pull requests, runs the automated checks (auth wrapper coverage, policy and approval tests, lint rule for secrets in journeys, integration tests), and builds the web, worker, and runner images from the same commit. Load test runs never go through CI.
- Image registry, tool environments, and deployment path: TBD (TBD-5).

### Roles

Viewer, engineer, approver, admin, stored in the database.

## Testing decisions

### Test strategy

Test observable behavior through API responses, final run states, whether the runner sent load, and entries in the audit log. Keep tests independent of internal functions and call order.

### Proposed test seams

- Primary seam (proposed): the platform API contract over a real database and queue, with the Executor swapped for the local implementation against a mock target. Most behavior (policy, hashing, approvals, state machine, queueing, results, audit) is tested here.
- Secondary seam (proposed): the agent wrapper as a process, driven by a fake control-plane API, for hash check, lease expiry, and STOP handling.
- Not unit-testable, verified on a real cluster in the spike and hardening: Operator behavior, network policy blocking, quotas, autoscaling, telemetry-loss abort, percentile accuracy against k6 summary.

### Test coverage

Core library (policy, hash, approvals, lease), auth wrapper (an automated test fails if any route skips it), state machine, agent wrapper, integrity adapter, report generation (content checklist).

### Safety review

Changes to the policy engine and to safety and abort behavior (lease, emergency stop, threshold abort, health probe, fail-closed telemetry) require review by the lead before merge (decision D21). The execution owner (Bayu) implements most of the safety code, so the lead acts as the second pair of eyes.

### Fail-safe test matrix

[Release gate 3](feature-breakdown.md#release-gates) covers five failures: dashboard down, web app down, worker down, one runner pod down, and telemetry lost. Each must stop load, and the evidence is recorded.

### Test conventions

Set test conventions during the foundation work. The repository has no code at this draft stage.

### Open QA dependency

QA role and deliverables (TBD-7).

## Non-goals

Not in this document or the 12-week staging MVP:

- A custom load-generation engine, a graphical scenario builder, or a script editor in the UI. Journey changes go through pull requests.
- AI root-cause diagnosis and SaaS billing.
- Automated production breaking-point tests, and any soak or stress run on a prod-like or production target.
- Qualifying 10k-50k+ virtual users. Load targets come from the reference peak. A 50,000-VU production test is not a gate.
- Mobile app measurement: startup, ANR, crash, battery, offline QR, offline scanner sync, and the scanner app itself.
- Real-user monitoring.
- Measuring email or SMS delivery.
- Lighthouse, Puppeteer, and Playwright, and the browser metrics k6 browser cannot provide: TBT, Long Animation Frames, Lighthouse score, page weight by type, third-party script time, JS error rate per session, INP on SPA route changes, multi-step per-step vitals.
- VM-based agents and any custom coordinator.
- Nightly baseline jobs and automatic release ID from a version endpoint. Baseline is pinned manually and release ID is an optional field.
- Server-side PDF generation. PDF is through browser print.
- External notifications (Teams, Slack, email) and live log streaming. In-app notifications only.
- ClickHouse for audit logs or any other data.
- Internal target metrics (APM, database) as abort signals.
- Per-project permissions. Roles are global.

## Open questions and TBD register

| **ID** | **Item** | **Owner** | **Needed by** | **Proposed default** |
| --- | --- | --- | --- | --- |
| TBD-1 | Confirm the initial role and capacity plan. Current baseline: Ahwalian = lead and planned non-UI web work; Bayu = current UI implementer and planned execution work. This is not a permanent ownership boundary: assignments may change at each sprint planning based on available capacity, priority, dependencies, delivery progress, risk, leave, and required review separation. The original capacity estimate predates the UI correction and must be recalculated | Engineering manager | Week 1, then every sprint | Confirm the sprint allocation and capacity forecast. Record material changes in the sprint plan; do not require a PRD revision for routine reassignment. Keep safety review independent from the primary implementer where practical |
| TBD-2 | Kick-off date, holiday and leave calendar, acceptance owner for each gate, and review checkpoints | Engineering manager | Before kick-off | 12 working weeks. Checkpoints at weeks 2, 6, 8, 12. The Engineering manager accepts gates, DevOps joins gates 3 and 4 |
| TBD-3 | Control-plane topology and network paths: cluster, namespaces, how runner pods reach the API and metrics store, how the worker reaches the staging database | DevOps | Week 1 | Same EKS cluster, separate control namespace, internal service access, explicit egress rules |
| TBD-4 | Mock target and local stack (Postgres, Redis, Prometheus, MinIO) | Bayu (proposed) | Week 2 | Add both to the foundation epic, about 0.5-0.75 dev-weeks |
| TBD-5 | CI is decided: Bitbucket Pipelines. Still open: container image registry, how the pipeline authenticates to it, how a new image version reaches the GitOps repo, and whether the tool has separate dev and prod environments | Lead, DevOps | Week 2 | Registry in AWS (ECR) with short-lived pipeline credentials. Pipeline builds and pushes images, then updates the GitOps repo. Two environments for the tool. Deploy through GitOps |
| TBD-6 | Security model for seed and cleanup hooks (HTTP and SQL) | Lead, DevOps | Week 3 | Named hooks registered by admin and reviewed through pull requests. Included in the manifest hash. No free-text SQL. Scoped credentials. Not allowed on prod-like |
| TBD-7 | QA role, deliverables, and platform test strategy | QA, Lead | Week 3 | QA reviews journey assertions, runs the fail-safe matrix and measurement validation, does UAT in weeks 11-12 |
| TBD-8 | Retention tiers and report sharing | Lead, Engineering manager | Week 6 | Reports and summary JSON 1 year. Raw artifacts 90 days. Share = login-protected run page plus downloadable HTML |
| TBD-9 | Identity and access dependencies: AWS access to the log group for engineers and approvers, Entra app registrations for web and Grafana | DevOps, IT admin | Weeks 2 and 6 | If CloudWatch access cannot be granted, batch log export to S3 moves into the MVP |
| TBD-10 | Names of the SRE and the ticketing owner (prod-like approvers) | Engineering manager | Week 7 | None |
| TBD-11 | Reference peak per target | Engineering manager | Week 2 | Projection from the Engineering manager (schools, capacity, buyers at on-sale) |
| TBD-12 | Absolute VU/RPS, duration, and ramp ceilings per environment | Engineering manager + DevOps | Week 3 | None |
| TBD-13 | Health endpoint on the target, and read-only staging database access for integrity | Ticketing team developer | Weeks 2-3 | If DB access is missing, integrity becomes a stretch goal |
| TBD-14 | Prod-like environment for the pre-launch pilot | Engineering manager + DevOps | Week 12 | None |
| TBD-15 | DevOps (about 2 days/week) and QA (about 2 days/week from week 3) allocation | Engineering manager | Week 1 | As stated |
| TBD-16 | Numeric targets marked TBD in the NFR table: stop time, lease TTL, percentile tolerance, report time, per-pod VU limits, availability | Lead | End of spike | Proposed values in the table |

### Items to reconcile

The source draft gives different treatments for the items below. The requirements and feature criteria retain their original values pending a decision.

| Item | PRD | Feature breakdown |
| --- | --- | --- |
| Summary JSON and report retention | [N8](#non-functional-requirements) and [TBD-8](#open-questions-and-tbd-register) propose one year for both. | [E5.7](feature-breakdown.md#e5-execution) sets 90 days for summary JSON. [E10.7](feature-breakdown.md#e10-platform) specifies a 90-day bucket lifecycle. |
| Approved window | Story 12 and N4 require a valid approval at start and prohibit starts outside the approved window. | [E4.4](feature-breakdown.md#e4-approvals) says the run can execute only inside that window. |
| Smoke load preset | Story 2 and D12 describe presets as relative to the target's reference peak. | [E2.4](feature-breakdown.md#e2-catalog-and-configuration) describes smoke as fixed. |
| QR budget | The [default product budgets](#default-product-budgets) list scan validation at ≤ 300 ms. | [E7.8](feature-breakdown.md#e7-journeys-and-k6-lib) also lists QR at ≤ 1 s, without a corresponding PRD metric. |

## Ownership and scope notes

- **[Team, roles, and capacity under D21](feature-breakdown.md#decision-log)** — The current planning baseline has Bayu implementing the UI and execution work, while Ahwalian acts as lead and is planned for non-UI web work. These are sprint allocations, not permanent ownership boundaries. At each sprint planning, the Engineering manager and lead may rebalance work based on available capacity, priority, dependencies, progress, delivery risk, leave, and the need for independent safety review. DevOps (about 2 days/week) owns the platform epic. QA (about 2 days/week from week 3) is shared. Business inputs (reference peak, ceilings, approver names, and prod-like environment) go to the Engineering manager. The original capacity estimate predates the UI correction and must be recalculated.
- **[Cut-line](feature-breakdown.md#cut-line)** — (1) release trend chart, (2) soak preset, (3) local mode without Docker, (4) integrity check if there is no data source. Never cut: safety controls, approvals, emergency stop, lease, HTML report, verdict. Because capacity has no slack, the first three items are assumed out of the committed scope from the start and return only if the spike is green and week 6 is on track.
- Unverified technical items to be checked in the spike: exact k6 metric names and percentile queries, whether the Prometheus version needs a flag for native histograms, server-sent streaming through a self-hosted Next.js route handler on long runs, the k6 Operator version and its status and cleanup behavior, log shipping under load, the payment sandbox rate limit, and how the production WAF/CDN identifies test traffic.
- Historical lessons built in: record p95/p99 and error rate on every run (the past trial only had averages), and make thresholds mandatory (the past 1,000-VU runs had none).

## Glossary

- *Run* — one execution of a scenario against a target, with an immutable manifest.
- *Manifest* — the full run plan, hashed with SHA-256. Approvals attach to a hash.
- *Scenario* — a versioned combination of journey reference, image version, parameters, load profile, and thresholds.
- *Journey* — k6 script code kept in the repository (browse-event, checkout, receive-poll, scan-ticket).
- *Lease* — a short-lived permission a runner pod must keep renewing. If it lapses, the pod stops.
- *Prod-like* — an environment with production-equivalent infrastructure and full approval rules. Does not exist yet.
- *Reference peak* — per-target expected peak load, provided by the Engineering manager and later replaced by baseline data.
- *Fail closed* — when a required signal is missing, stop rather than continue.
