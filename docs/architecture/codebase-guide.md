# BTB Codebase Guide

This guide explains the current BTB implementation. Use the [learning path](codebase-learning-path.md) for a staged reading plan and the [runbook](../operations/runbook.md) for operating procedures.

## Purpose

BTB is a control plane for safe, repeatable k6 performance tests against a ticketing system. Engineers define a run; policy and approvers authorize an immutable manifest; a separate worker executes it; the web app presents live metrics, results, integrity checks, reports, and audit history.

The web process never runs k6 directly. Long-running and recoverable work belongs to the worker.

## Repository map

| Path | Responsibility |
| --- | --- |
| `apps/web` | Next.js UI and API routes; authentication, authorization, run commands, SSE, reports |
| `apps/worker` | BullMQ consumer, scheduler, preflight, executors, reconciliation, live sampling, finalization |
| `packages/contracts` | Shared types, constants, Redis keys, runner protocol, and Zod request schemas |
| `packages/core` | Drizzle schema, migrations, policy, approvals, manifest hashing, audit, executor and integrity contracts |
| `packages/k6-lib` | Runner self-verification, request guards, lease, metrics, evidence, and test-data partitioning |
| `journeys` | Versioned k6 journeys and runner-image catalog |
| `infra/local` | Compose services: PostgreSQL, Redis, RedisInsight, MinIO, mock target, optional Grafana/worker |
| `infra/kind` | Local Kubernetes, k6 Operator, namespaces, quotas, network policy, RBAC, and monitoring |
| `infra/mock-target` | Ticketing UI and benchmark API with reset, integrity, latency, error, and payment fault controls |
| `scripts/dev.sh` | Idempotent local startup, status, and shutdown orchestration |

## System architecture

```text
Browser
  │ HTTP / SSE
  ▼
Next.js web
  ├── PostgreSQL: durable application state
  ├── BullMQ/Redis: worker wake-up signal
  ├── Redis: live samples and worker heartbeat
  └── MinIO: authorized artifact downloads
          │
          ▼
Node worker
  ├── PostgreSQL advisory lock and state transitions
  ├── KubernetesExecutor or local-only DockerExecutor
  ├── Prometheus queries
  ├── Redis live-sample publication
  └── MinIO artifact upload
          │
          ▼
k6 runner
  ├── verifies manifest, approval, protocol, and lease
  ├── applies request allowlists and test-data partitioning
  ├── sends load to the target
  └── remote-writes metrics to Prometheus
```

## Sources of truth

| Concern | Source of truth |
| --- | --- |
| Run state, approvals, audit, summaries, artifact metadata | PostgreSQL |
| Queue internals, heartbeat, transient live samples | Redis |
| Time-series measurements | Prometheus |
| Reports, logs, screenshots, summary files | MinIO/S3 |
| Actual runner workload state | Kubernetes or Docker executor |
| Product requirements | `docs/product/prd.md` |
| Operating procedure | `docs/operations/runbook.md` |

BullMQ does not own run state. A BullMQ job wakes the worker; the worker reads authoritative state from PostgreSQL. If enqueue fails after the database transaction commits, the worker's periodic sweep still finds queued work.

## Core domain model

### Plan, manifest, and hash

A plan is user input: scenario version, target, environment, preset, network profile, and optional release ID. `evaluatePlan` resolves it against the catalog and ceilings. `manifestOf` creates the concrete immutable execution instruction. `hashManifest` hashes canonical JSON.

```text
RunPlanInput
  → evaluatePlan
  → ResolvedPlan
  → manifestOf
  → RunManifest
  → canonical JSON + SHA-256
  → manifestHash
```

Approvals are bound to the manifest hash. Editing the plan changes the hash and invalidates prior approvals.

Relevant files:

- `packages/contracts/src/schemas.ts`
- `packages/core/src/policy.ts`
- `packages/core/src/manifest.ts`
- `packages/core/src/approvals.ts`

### Run states

```text
draft
  ├── low-risk staging rule ─────────────► approved
  └── human approval required ─► pending_approval ─► approved

approved ─► queued ─► starting ─► running ─► completed
                │          │          ├────► failed
                │          │          └────► aborted
                └──────────┴───────────────► rejected/approved after a blocked start
```

- `queued`: start was requested, but no load is guaranteed yet.
- `starting`: the executor resource exists; runner verification or startup is pending.
- `running`: execution is observed as active.
- `stopping`: stop was accepted; termination is still in progress.
- `completed`: execution ended normally. Its verdict may still be `fail`.
- `failed`: infrastructure or execution failed.
- `aborted`: a safety mechanism or operator stopped the run.
- `rejected`: authorization or approval rejected the run.

Status describes execution outcome. Verdict describes whether measured thresholds and integrity rules passed.

## End-to-end flows

### Create a run

```text
POST /api/runs
  → withAuth + runPlanInputSchema
  → load project catalog
  → evaluatePlan
  → manifestOf + hashManifest
  → transaction:
      insert run
      add automatic approval when eligible
      append audit row
  → return run detail
```

Primary files:

- `apps/web/src/app/api/runs/route.ts`
- `apps/web/src/lib/server/run-actions.ts` (`createRun`)
- `apps/web/src/lib/server/catalog.ts`

API bodies are parsed by shared Zod schemas through `withAuth`; business-policy failures remain explicit 422 responses.

### Approve a run

The server verifies role, starter/approver separation, uniqueness, manifest hash, validity period, and approval window. Staging smoke/baseline/peak runs within ceilings may be auto-approved; riskier or prod-like runs require human approval according to policy.

Primary files:

- `apps/web/src/app/api/runs/[id]/approve/route.ts`
- `apps/web/src/lib/server/approvals.ts`
- `packages/core/src/approvals.ts`

### Start a run

```text
POST /api/runs/:id/start
  → reload current state
  → re-check policy, manifest hash, approval, and web preflight
  → transaction: approved → queued + audit
  → enqueue BullMQ `dispatch`
  → return immediately
```

The database transition commits before enqueue. This prevents a worker from receiving a job for state that does not yet exist and allows the periodic sweep to recover a failed enqueue.

Primary files:

- `apps/web/src/app/api/runs/[id]/start/route.ts`
- `apps/web/src/lib/server/run-actions.ts` (`startRun`)
- `apps/web/src/lib/server/redis.ts`

### Dispatch and preflight

```text
BullMQ job or periodic sweep
  → PostgreSQL advisory lock
  → read queued and active runs
  → schedule within target/namespace limits
  → verify manifest hash, approval, protocol, window, health,
    monitoring, test data, and capacity
  → seed test data
  → executor.create(...)
  → queued → starting
```

The scheduler enforces one active run per target and two per namespace. The lock prevents concurrent jobs or worker replicas from allocating the same capacity.

Primary files:

- `apps/worker/src/main.ts`
- `apps/worker/src/dispatch.ts`
- `apps/worker/src/plan.ts`
- `apps/worker/src/lock.ts`

### Runner self-verification

Before VUs start, each runner fetches the current manifest with a short-lived HMAC token, recomputes its hash, validates approval and protocol, and obtains its first lease. A failure aborts before target traffic begins.

Safety is layered:

1. Web policy and authorization.
2. Worker preflight.
3. Runner manifest and allowlist verification.
4. Kubernetes RBAC, NetworkPolicy, quota, CPU, and memory limits.
5. Lease fail-closed behavior.

Primary files:

- `apps/web/src/app/api/runner/manifest/route.ts`
- `apps/web/src/app/api/runner/lease/route.ts`
- `apps/web/src/app/api/runner/callback/route.ts`
- `packages/k6-lib/src/runner.ts`
- `packages/k6-lib/src/guard.ts`
- `packages/k6-lib/src/lease.ts`

### Live metrics

```text
k6 remote write
  → Prometheus
  → worker sampleLive every 5 seconds
  → Redis list `btb:run:<id>:samples`
  → Next.js SSE route
  → React live view
```

The worker performs one query loop per active run. Additional viewers consume the same stream and do not multiply Prometheus queries.

Primary files:

- `apps/worker/src/prometheus.ts`
- `apps/worker/src/live.ts`
- `apps/web/src/app/api/runs/[id]/live/route.ts`
- `apps/web/src/components/runs/live-run.tsx`

### Reconciliation and recovery

Reconciliation compares durable run rows with executor state. It promotes `starting` to `running`, detects terminal workloads, processes stops, handles timeouts, and removes orphaned resources. A restarted worker reconstructs progress from PostgreSQL and the executor instead of relying on a missed event.

Primary files:

- `apps/worker/src/reconcile.ts`
- `apps/worker/src/executors.ts`
- `packages/core/src/executor.ts`

`KubernetesExecutor` is the normal executor. `DockerExecutor` is development-only, is refused in production, and can load only loopback targets.

### Stop a run

- A queued run returns to `approved`; it has not sent load.
- An active run becomes `stopping`; the worker deletes the execution resource, the lease endpoint returns stop, and finalization records an aborted outcome.

Primary files:

- `apps/web/src/lib/server/run-actions.ts` (`stopRun`)
- `apps/worker/src/reconcile.ts` (`stopRun`)
- `packages/k6-lib/src/lease.ts`

### Finalization

```text
terminal executor state or signed runner callback
  → collect Prometheus summary
  → compare generator evidence
  → run integrity adapter
  → derive verdict and caveats
  → cleanup test data
  → upload artifacts
  → transaction: terminal status + summary + audit
  → delete execution resource
  → dispatch the next queued run
```

Primary files:

- `apps/worker/src/finish.ts`
- `apps/worker/src/summary.ts`
- `apps/worker/src/integrity.ts`
- `apps/worker/src/artifacts.ts`
- `packages/core/src/integrity.ts`

The mock target exposes a read-only integrity endpoint. A configured target without a usable adapter receives `integrity_not_verified`; non-zero oversold, double-charge, or charged-without-ticket counts fail the verdict.

## Local development

Use the root scripts rather than starting each dependency manually:

```sh
pnpm dev:up        # Compose + kind + migrations + seeds + worker
pnpm dev:up:ui     # Compose + migrations + seeds; no Kubernetes
pnpm dev           # Next.js at http://localhost:3001
pnpm dev:status
pnpm dev:down
pnpm check
```

Important local interfaces:

| Service | Address |
| --- | --- |
| Web | `http://localhost:3001` |
| Ticketing mock target | `http://localhost:8081` |
| PostgreSQL | `127.0.0.1:15432` |
| Redis | `127.0.0.1:16379` |
| RedisInsight | `http://localhost:5540` |
| Prometheus | Run `kubectl -n monitoring port-forward svc/prometheus 9091:9090`, then open `http://localhost:9091` |
| MinIO console | `http://localhost:19001` |
| Optional Grafana | `http://localhost:3300` |

See the [root README](../../README.md) for setup details and the [runbook](../operations/runbook.md) for troubleshooting and emergency procedures.

## Security boundaries

| Boundary | Required controls |
| --- | --- |
| Browser → web API | Session, role, shared schema, policy, resource access |
| Web → worker | Durable database state plus BullMQ signal |
| Worker → executor | Restricted service account or local-only Docker guard |
| Runner → platform | Short-lived HMAC token and signed callbacks |
| Runner → target | Manifest allowlist and NetworkPolicy |
| User → artifact | Per-run authorization and short-lived access |

Middleware is not sufficient authorization. Every API handler is wrapped by `withAuth` or `withRunnerAuth`, and an automated test scans route files for violations.

## Verification

```sh
pnpm check
```

This runs package type checks, lint, unit tests, and mock-target integration tests. For infrastructure behavior, also use the runbook's kind, Prometheus, RedisInsight, and Grafana checks.
