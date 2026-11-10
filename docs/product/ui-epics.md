# E12: Web UI — local plan

Draft, not in Jira yet (except the epic shell BTB-39). Paste stories into Jira when ready.

- **Design system:** Arbiter Benchmark UI — https://claude.ai/artifact/T35xtMeBuGZfyY4ohohNPR
- **Screen plan:** BTB UI Plan — https://claude.ai/artifact/TdrFEHdepPFZeNGUk7qUnG
- **Stack (PRD D1):** Next.js + TypeScript in `apps/web`, Recharts or ECharts, Entra ID via Auth.js, zod contracts in `packages/contracts`.

## Planning and ownership

Bayu is the current UI implementer. This identifies the present sprint allocation, not permanent ownership of every UI story. UI, API, execution, and review work may be reassigned between Bayu and Ahwalian during sprint planning based on capacity, priority, dependencies, progress, risk, leave, and the need for independent review. Material allocation changes belong in the sprint plan; routine reassignment does not require rewriting the PRD.

## Rules for every story

- Every screen has empty, loading, error, and no-permission states.
- UI hides or disables actions by role; the server re-checks every action.
- Until the backend exists, use mock data shaped like `packages/contracts`.
- Follow the design system: black primary, blue accent once per page, floating-label fields, no native validation, every async action shows a spinner, every mutation ends in a toast.

## Stories

| # | Story | PRD | Weeks | Related epic | Status |
|---|---|---|---|---|---|
| UI-01 | App shell and shared components | — | 1–2 | all | Done (local) |
| UI-02 | Login (Entra ID SSO) | E1.1 | 1–2 mock, 3–6 real | BTB-2 E1 | Done (mock); real Entra ID waits on app registration |
| UI-03 | Runs list (golden reference page) | E3.6, E9.5 | 1–2 | BTB-4 E3, BTB-10 E9 | Done (mock API) |
| UI-04 | Create run form | E3.1, E2.4, E2.5 | 3–6 | BTB-4 E3, BTB-3 E2 | Done (mock API) |
| UI-05 | Run detail | E3.6, E5.7, E5.8 | 3–6 | BTB-4 E3, BTB-6 E5 | Done (mock API) |
| UI-06 | Scenarios and journey catalog | E2.2, E2.3 | 3–6 | BTB-3 E2 | Done (mock API) |
| UI-07 | Admin: projects, environments, targets, users, test data | E1.3, E2.1, E2.6 | 3–6 | BTB-2 E1, BTB-3 E2 | Done (mock API) |
| UI-08 | Approvals inbox and review | E4.2–E4.5 | 7–8 | BTB-5 E4 | Done (mock API) |
| UI-09 | Live run view and emergency stop | E8.3, E6.2 | 9–10 | BTB-9 E8, BTB-7 E6 | Done (mock API) |
| UI-10 | Run results, baseline compare | E9.1–E9.4, E8.4, E8.5 | 9–10 | BTB-10 E9, BTB-9 E8 | Done (mock API) |
| UI-11 | HTML report (static, A4 print) | E9.6 | 11–12 | BTB-10 E9 | Done (mock API) |

### UI-01: App shell and shared components

**Scope**
- Shell: 80 px sidebar of labelled tiles (Runs, Approvals with badge, Scenarios, Admin), 60 px topbar with breadcrumb, theme toggle, user name and role with dropdown (sign out). Floating content card. Mobile bottom nav.
- Menus the role cannot access are hidden.
- Project switcher as the first breadcrumb item (pinned, never collapses): active project is per session, kept in a session cookie and read on the server; switching from a detail page returns to that section's list. One project = plain label; admins get "Manage projects" (links to UI-07).
- Run status pill for 11 statuses: draft (neutral); pending_approval, queued (warning); approved (info); starting, running, stopping (brand, animated dot); completed (success); failed, aborted, rejected (danger).
- Design tokens (light + dark) as CSS variables from `tokens.json`.
- Later stories add: metric card, hash display, verdict banner, policy-violation list, preflight checklist, emergency stop button.

**Acceptance**
- Every colour is a CSS variable; light and dark both work.
- Keyboard focus visible on every nav item and button.
- Typecheck and lint pass.

### UI-02: Login (Entra ID SSO)

- App mark and one "Sign in with Microsoft" button. No username/password form.
- After login, land on Runs.
- Signed in but no role: "Your account has no access yet. Contact an admin."
- SSO failure: message plus "Try again".

### UI-03: Runs list (golden reference page)

- Table: scenario, target, environment, preset, status, Release ID, created by, time, verdict.
- Filters: target, scenario, Release ID, result (pass/fail).
- "Create run" button (engineer and above); row click opens Run detail.
- Queued runs show queue position and the blocking run.
- Every later page must match this page's quality.

### UI-04: Create run form

- Fields: scenario (with version), target, environment, load preset, network profile (Stadium 4G or Wi-Fi baseline), optional Release ID.
- Computed: resulting load (VUs or RPS), approval requirement (auto, 1 approver, 2 approvers).
- Policy rejection (HTTP 422): show every violation next to its field.
- Opens as a wide right sheet from the Runs list; `/runs/new` opened directly is a full page. After saving, the list shows the new run highlighted.
- Built: `POST /api/runs` + `lib/runs/policy.ts` (one pure policy used by the form preview and the API). Assumptions until TBD-12 and the catalog API: placeholder ceilings, smoke fixed at 5 (E2.4 vs story 2 conflict), spike = 5× reference peak, a run without approvers waits for Start as `approved`.

### UI-05: Run detail

- Status, full manifest and hash, approvals (who, when, expiry), status timeline, preflight result per check.
- Actions: Start (enabled only when all conditions pass), Edit (invalidates prior approvals), "Open logs in CloudWatch", download artifacts.
- Preflight failed: show failing checks. Aborted: show reason.
- Open: does Edit create a new manifest or modify the row?
- Built: `GET/PATCH /api/runs/[id]`, `POST /api/runs/[id]/start`, `GET /api/runs/[id]/artifacts/[name]`, logic in `lib/runs/detail.ts` and `lib/runs/actions.ts`. Edit reuses the Create run sheet.
- Assumptions: Edit changes the same row (new hash, earlier approvals void, decided again by policy). Approvals last 24 h and the approved window equals that validity. Preflight is simulated (checkout-staging's test-data pool is empty, so Start fails there). Approvals, timeline and artifacts for mock history are derived from timestamps; Start/Edit events are real. A started run stays "starting" until the live loop exists (UI-09).

### UI-06: Scenarios and journey catalog

- Journey catalog: read-only, synced from the runner image (name, version, parameter schema).
- Scenarios: list and versions. Saving always creates a new version; old versions are immutable.
- Built: `/scenarios` (Scenarios and Journeys tabs), `/scenarios/[name]` (version history, changes from the previous version), new scenario / new version sheet, `POST /api/scenarios`, rules in `lib/runs/scenarios.ts`.
- Assumptions: a scenario version = journey + runner image + parameters + load model (closed VUs or open arrival rate) + p95 and error-rate thresholds (both mandatory, E6.3); load size stays with the run preset. A new version keeps its journey. A save with no change is refused, but moving to a newer runner image counts as a change. Journeys are global (one runner image), scenarios belong to a project. Catalog sync, journey budgets per target and extra thresholds wait for the catalog API.

### UI-07: Admin

- Projects, environments, targets: CRUD. Target holds allowlist (hostname, path, method, redirect destinations), reference peak, health endpoint.
- Users and roles: viewer, engineer, approver, admin.
- Test-data pool: identities per target, seed/cleanup hooks (form shape waits on TBD-6).
- Built: `/admin` with Projects, Targets (active project), Environments, People, Test data and Activity tabs; `/api/admin/*` (admin only, checked on every route); rules in `lib/admin/validate.ts` and `lib/admin/actions.ts`. Admin edits flow into Create run (new targets, ceilings) and sign-in (roles apply on the next request).
- Assumptions: environments are fixed to staging and prod-like (a third needs a namespace from DevOps); admins edit their ceilings. A target's name is fixed after create, and a target with runs can't change environment or be deleted. Only empty projects can be deleted. Nobody can change their own role, and the last admin can't be demoted. "No access" keeps the person and their history. Test data and hooks are read-only until TBD-6 and identity provisioning exist; the Activity tab is an in-memory stand-in for the audit log (open question 4).

### UI-08: Approvals inbox and review

- Inbox: runs awaiting your approval; count badge in the sidebar.
- Review: full plan (target, max load, duration, window, thresholds) with hash; Approve and Reject.
- You created the run: Approve disabled with explanation. Approval expired or hash changed: "Needs re-approval".
- Built: `/approvals` inbox (yours first, the rest say why you can't act), review sheet with Approve / Reject (reason required), live Reviews badge, `POST /api/runs/[id]/approve` and `/reject`, rules in `lib/runs/approvals.ts`.
- Assumptions: the inbox and badge are per active project. An approval binds to the manifest hash and lasts 24 h; the approved window is that 24 h. Re-approving an expired approval gives a new window without an edit. Admins can approve (role ladder). The starter is matched by name until runs store the creator's user id. Seeded approvers are "SRE on call" and "Ticketing owner" (names TBD before week 7). No Teams/Slack notifications (PRD: in-app only).

### UI-09: Live run view and emergency stop

- VUs, RPS, p95, p99, error rate with threshold lines, time remaining. Updates every 5 s over SSE.
- Emergency stop always visible, with in-page confirmation.
- Live connection lost: "Data delayed" marker; stop button stays visible.
- Built: live panel on the Run detail page for starting/running/stopping runs (`components/runs/live-run.tsx`), `GET /api/runs/[id]/live` (SSE: snapshot, tick every 5 s, end), `POST /api/runs/[id]/stop`, Emergency stop in the sticky header. A mock lifecycle (`lib/runs/lifecycle.ts`) moves runs along: starting → running after 15 s, running → completed at the end of the profile, stopping → aborted (emergency stop) after 4 s; the next queued run on the target then starts.
- Assumptions: engineers and above can stop (PRD "specific roles", exact list open). Data delayed after 12 s without an update. Samples are generated (deterministic per run and second) until the worker's Prometheus/Redis loop exists (E8.1/E8.2). The mock lifecycle advances when someone loads runs, a run or its live stream.

### UI-10: Run results

- Verdict with caveats (measurement gap, generator saturated, integrity not verified), p50/p95/p99, error rate, peak RPS, max VUs, planned vs achieved load.
- Browser: LCP, INP, CLS, FCP, TTFB per journey. TBT shown as "not measured (Phase 2)".
- Integrity: double-sold seats, double payments, paid without ticket.
- Actions: Set as baseline, compare with baseline, open in Grafana, open HTML report.
- Built: results on the Run detail page for runs that sent load (`components/runs/run-results.tsx`): verdict banner with caveats explained, p50/p95/p99, error rate, peak RPS, max VUs, planned vs achieved, baseline comparison with deltas and a regression flag, browser timings per step (TBT "Not measured (Phase 2)"), integrity counts. Header: Grafana, Report, Set as baseline. `POST /api/runs/[id]/baseline`; numbers in `lib/runs/results.ts`.
- Assumptions: a baseline is per target + scenario + preset (comparing a smoke run with a peak run is meaningless), seeded with the oldest passing run, and any completed run can be pinned. Regression = p95 +10%, errors +0.2 pp, or peak RPS -10% against the baseline. Integrity is only available for the Ticketing project (needs read-only DB access, TBD-13); elsewhere the verdict carries "integrity not verified". Browser budgets are the PRD defaults and shown per step, not counted in the verdict. Numbers are generated to agree with each run's stored verdict until the summary job (E9.1) exists. Grafana host is a placeholder.

### UI-11: HTML report

- One self-contained HTML file (inline CSS, static SVG charts), generated server-side, stored in S3.
- Contents: scenario and version, target and environment, window, approvals, planned vs achieved, p50/p95/p99, errors, baseline comparison, verdict, caveats, next-test recommendation.
- A4 print stylesheet; "Download PDF" via browser print.
- Built: `GET /api/runs/[id]/report` renders the report (`lib/runs/report.ts`); `?download=1` saves it as `RUN-xxxx-report.html`. The Report button on finished runs opens it in a new tab; its toolbar (hidden in print) has Download HTML and Download PDF. Checked: no external requests (logo inlined as a data URI), prints on A4 in 2 pages, people-entered text is escaped.
- Assumptions: rendered on request from the stored summary instead of generated once and stored in S3 within 30 s of the run ending (needs the summary job and artifact storage, E9.1/E5.7). Times are shown in UTC so a shared file reads the same everywhere. The recommended next test follows simple rules: fix-and-repeat for a fail or saturation, otherwise the next preset up (smoke → baseline → peak → spike → soak).

## Open questions

1. Role hierarchy: do approver and admin inherit engineer rights?
2. Edit after approval: new manifest or same row?
3. Audit log screen: needed in MVP?
4. Seed/cleanup hook form: waits on TBD-6.

## Implementation

- `apps/web` — Next.js 15 + Tailwind v4 + shadcn/Radix, styled to the Arbiter Benchmark UI tokens. Component gallery at `/gallery`. See `apps/web/README.md`.
