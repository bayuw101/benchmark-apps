# BTB Codebase Learning Path

This path teaches the current BTB implementation from its vocabulary to a complete run. Read the linked symbols, perform the checkpoint, and continue only when you can explain the result without the guide.

For conceptual explanations, keep the [codebase guide](codebase-guide.md) open. For commands used during incidents or test execution, use the [runbook](../operations/runbook.md).

## Learning outcomes

By the end, you should be able to:

1. Explain where run, queue, metric, and artifact data live.
2. Trace Create, Approve, Start, Stop, and Finish requests.
3. Explain why BullMQ is a signal rather than the run source of truth.
4. Follow a run from PostgreSQL to k6 and back to a report.
5. Diagnose a queued, stuck, aborted, or measurement-gap run.
6. Identify each trust boundary and its protection.

## Level 0: Run the system

**Goal:** identify each process before reading implementation details.

Read:

1. `README.md`
2. `scripts/dev.sh`
3. `infra/local/docker-compose.yml`
4. `infra/kind/up.sh`
5. Root `package.json`

Run:

```sh
pnpm dev:up
pnpm dev
pnpm dev:status
```

For UI-only work, use `pnpm dev:up:ui`; runs intentionally do not start without the worker and Kubernetes.

Observe:

- Web: `http://localhost:3001`
- Ticketing target: `http://localhost:8081`
- RedisInsight: `http://localhost:5540`
- Prometheus: run `kubectl -n monitoring port-forward svc/prometheus 9091:9090`, then open `http://localhost:9091`
- MinIO: `http://localhost:19001`

**Checkpoint:** draw `browser → web → worker → executor → target` and place PostgreSQL, Redis, Prometheus, and MinIO on it.

## Level 1: Learn the shared vocabulary

**Goal:** understand data shapes and states before following control flow.

Read in order:

1. `packages/contracts/src/index.ts`
   - `RUN_STATUSES`
   - `RunManifest`
   - `PreflightResults`
   - `LiveSample`
   - `RunnerConfig`
   - `redisKeys`
   - `RUNS_QUEUE` and `RunJob`
2. `packages/contracts/src/schemas.ts`
   - `runPlanInputSchema`
   - `runManifestSchema`
   - runner callback and lease schemas
3. `packages/core/src/db/schema.ts`
   - `runs`
   - `approvals`
   - `runSummaries`
   - `runArtifacts`
   - `auditLogs`
4. `packages/core/src/manifest.ts`

Run:

```sh
pnpm --filter @btb/contracts check
```

**Checkpoint:** explain the difference between a plan, manifest, manifest hash, run status, and verdict.

## Level 2: Understand policy and approval

**Goal:** isolate business rules from transport and infrastructure.

Read:

1. `packages/core/src/policy.ts`
   - `PRESETS`
   - `approversFor`
   - `evaluatePlan`
   - `manifestOf`
2. `packages/core/src/approvals.ts`
   - `validApprovals`
   - `approvalsSatisfied`
3. `packages/core/src/audit.ts`
4. `packages/core/src/core.test.ts`

Run:

```sh
pnpm --filter @btb/core test
```

Questions:

- Which staging plans can be auto-approved?
- Why does an edit invalidate approval?
- Which checks are schema validation and which are policy validation?
- Why must audit rows share the business transaction?

**Checkpoint:** choose one policy test, predict its violations, then run it.

## Level 3: Trace web API boundaries

**Goal:** understand authentication, parsing, authorization, and error handling.

Read:

1. `apps/web/src/middleware.ts`
2. `apps/web/src/lib/server/with-auth.ts`
3. `apps/web/src/lib/server/with-auth.test.ts`
4. `apps/web/src/app/api/runs/route.ts`
5. `apps/web/src/app/api/runs/[id]/route.ts`
6. `apps/web/src/app/api/runs/[id]/approve/route.ts`
7. `apps/web/src/app/api/runs/[id]/start/route.ts`
8. `apps/web/src/app/api/runs/[id]/stop/route.ts`

Pay attention to:

- `withAuth` versus `withRunnerAuth`.
- Shared Zod schemas.
- Role checks inside handlers rather than middleware alone.
- 400 shape errors versus 422 business-policy errors.
- Request-size and signature checks on runner routes.

Run:

```sh
pnpm --filter @btb/web test -- src/lib/server/with-auth.test.ts
```

**Checkpoint:** for one public request and one runner request, list authentication, authorization, validation, and resource-access checks in order.

## Level 4: Trace Create, Edit, Start, and Stop

**Goal:** follow commands from routes to durable state.

Read:

1. `apps/web/src/lib/server/run-actions.ts`
   - `createRun`
   - `editRun`
   - `startRun`
   - `stopRun`
   - `setBaseline`
2. `apps/web/src/lib/server/runs.ts`
3. `apps/web/src/lib/server/catalog.ts`
4. `apps/web/src/lib/server/redis.ts`

Create flow:

```text
input → schema → catalog → policy → manifest/hash
      → transaction(run + approval + audit)
```

Start flow:

```text
reload → policy/approval/preflight → transaction(queued + audit)
       → BullMQ dispatch signal
```

Stop flow:

```text
queued → approved, no load sent
active → stopping, worker terminates executor resource
```

**Checkpoint:** create and start a local smoke run. Inspect `runs` and `audit_logs` before and after Start.

## Level 5: Inspect BullMQ and worker startup

**Goal:** understand job delivery and recovery when Redis delivery fails.

Read:

1. `apps/web/src/lib/server/redis.ts`
2. `apps/worker/src/main.ts`
3. `apps/worker/src/env.ts`
4. `apps/worker/src/context.ts`

Use RedisInsight:

1. Open `http://localhost:5540`.
2. Connect to `redis:6379` from the RedisInsight container.
3. Search for `bull:btb-runs:*`.
4. Search for `btb:*` heartbeat and live-sample keys.

Important distinction:

- A BullMQ job is short-lived worker work.
- A BTB run is a durable, potentially hours-long lifecycle.
- Periodic worker sweeps recover queued database state even if enqueue failed.

**Checkpoint:** observe a dispatch job move through BullMQ and compare its lifetime with the run row.

## Level 6: Study scheduling and worker preflight

**Goal:** understand how queued work receives capacity safely.

Read:

1. `apps/worker/src/plan.ts`
   - `schedule`
   - runner configuration helpers
   - live and summary queries
2. `apps/worker/src/plan.test.ts`
3. `apps/worker/src/lock.ts`
4. `apps/worker/src/dispatch.ts`
   - `dispatch`
   - `startRun`
   - `approvalCheck`
   - `workerPreflight`
   - `probeTarget`
5. `apps/worker/src/hooks.ts`

Run:

```sh
pnpm --filter @btb/worker test
```

Verify these constraints:

- One active run per target.
- Two active runs per namespace.
- Approval and manifest are rechecked near execution.
- Target health, monitoring, runner capacity, and test data are checked.
- Scheduling runs under a PostgreSQL advisory lock.

**Checkpoint:** predict the scheduler decision for three queued runs sharing a target, then confirm with a focused test.

## Level 7: Understand executors and Kubernetes

**Goal:** learn the boundary between BTB control state and the actual workload.

Read:

1. `packages/core/src/executor.ts`
2. `apps/worker/src/executors.ts`
3. `apps/worker/src/kube.ts`
4. `infra/kind/testrun.yaml`
5. `infra/kind/manifests/10-guardrails.yaml`
6. `infra/kind/manifests/40-worker-rbac.yaml`

Compare:

- `KubernetesExecutor`: normal staging/prod-like execution through k6 Operator.
- `DockerExecutor`: development-only, rejected in production, loopback targets only.

Useful commands:

```sh
kubectl get testruns -A
kubectl get pods -A
kubectl describe testrun -n <namespace> <name>
```

**Checkpoint:** explain why executor status, rather than the original BullMQ job, determines whether a run is active.

## Level 8: Follow runner verification and journeys

**Goal:** understand what happens before and during target traffic.

Read:

1. `packages/k6-lib/src/runner.ts`
2. `packages/k6-lib/src/guard.ts`
3. `packages/k6-lib/src/lease.ts`
4. `packages/k6-lib/src/testdata.ts`
5. `packages/k6-lib/src/evidence.ts`
6. `journeys/src/main.ts`
7. One complete journey, starting with `journeys/src/checkout/`
8. `infra/mock-target/server.mjs`

Trace:

```text
runner config
  → fetch current manifest
  → recompute hash
  → verify approval and protocol
  → first lease
  → partition test identities
  → execute journey with request guards
  → signed callback and evidence
```

Run:

```sh
pnpm --filter @btb/k6-lib test
node --test infra/mock-target/server.test.mjs
```

**Checkpoint:** identify every layer that prevents a runner from sending traffic to an unapproved host.

## Level 9: Trace live metrics

**Goal:** follow one sample from k6 to the chart.

Read:

1. `apps/worker/src/prometheus.ts`
2. `apps/worker/src/live.ts`
3. `apps/worker/src/plan.ts` live queries
4. `packages/contracts/src/index.ts` (`LiveSample`, `redisKeys`)
5. `apps/web/src/app/api/runs/[id]/live/route.ts`
6. `apps/web/src/components/runs/live-run.tsx`

Flow:

```text
k6 → Prometheus → worker query → Redis list → SSE → React
```

Observe during an active run:

- Prometheus metrics filtered by run ID.
- `btb:run:<id>:samples` in RedisInsight.
- The SSE request in browser DevTools.
- The corresponding chart update.

**Checkpoint:** explain why 20 viewers still produce one Prometheus query loop.

## Level 10: Study reconciliation, stopping, and recovery

**Goal:** understand how BTB survives delayed signals and worker restarts.

Read:

1. `apps/worker/src/main.ts` (`tick`, `liveTick`, `shutdown`)
2. `apps/worker/src/reconcile.ts`
   - `reconcile`
   - `reconcileRun`
   - `markRunning`
   - `stopRun`
   - orphan sweep
3. `apps/worker/src/guards.ts`
4. `apps/worker/src/executors.ts`

Flow:

```text
periodic tick
  → compare PostgreSQL and executor state
  → promote starting to running
  → finalize terminal workloads
  → process stopping runs
  → detect timeout, missing pod, telemetry, and health failures
  → clean orphaned resources
```

**Checkpoint:** in local kind only, restart the worker during a run and confirm that reconciliation resumes supervision.

## Level 11: Study results, integrity, and artifacts

**Goal:** understand how execution becomes a verdict and report.

Read:

1. `apps/worker/src/summary.ts`
2. `apps/worker/src/integrity.ts`
3. `packages/core/src/integrity.ts`
4. `apps/worker/src/artifacts.ts`
5. `apps/worker/src/finish.ts`
6. `apps/web/src/app/api/runs/[id]/report/route.ts`
7. `apps/web/src/app/api/runs/[id]/artifacts/[name]/route.ts`
8. `apps/web/src/components/runs/run-results.tsx`

Distinguish:

- Execution status from performance verdict.
- Journey counters from target-side integrity reconciliation.
- Durable summary fields from retained Prometheus detail.
- Artifact metadata from object contents.
- `measurement_gap`, `generator_saturated`, and `integrity_not_verified` caveats.

**Checkpoint:** take a completed run ID and locate its run row, summary, audit entries, Prometheus series, and MinIO objects.

## Level 12: Review security and operational evidence

**Goal:** connect code controls to release evidence and operating procedures.

Read:

1. `docs/operations/runbook.md`
2. `docs/evidence/go-no-go.md`
3. Evidence under `docs/evidence/m5/`
4. `infra/kind/netpol-check.sh`
5. `infra/grafana/dashboards/`
6. `bitbucket-pipelines.yml`

Review the trust boundaries:

```text
browser → web API
web → worker intent
worker → executor
runner → platform
runner → target
user → artifact
```

**Checkpoint:** for each boundary, name the authentication, authorization, validation, and containment control.

## Recommended study schedule

| Session | Levels | Expected outcome |
| --- | --- | --- |
| 1 | 0–2 | Draw the architecture and explain the domain model |
| 2 | 3–4 | Trace API validation and durable command transactions |
| 3 | 5–6 | Inspect BullMQ and explain scheduling/preflight |
| 4 | 7–8 | Explain executors, runner verification, and journey execution |
| 5 | 9–10 | Trace live data and recovery behavior |
| 6 | 11–12 | Trace finalization and evaluate operational controls |

## Completion test

Choose one real local run ID and explain, without guessing:

1. Who created and approved it.
2. Which manifest hash was authorized.
3. Which BullMQ signal woke the worker.
4. Why the scheduler allowed or delayed it.
5. Which executor resource ran it.
6. How the runner verified itself.
7. Where its live samples travelled.
8. Why it stopped.
9. How its verdict and caveats were derived.
10. Where its report, artifacts, audit history, and metrics are stored.

If you can do this from the browser to the runner and back to the report, you understand the BTB execution path.
