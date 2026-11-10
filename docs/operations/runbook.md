# BTB Runbook

How to run a load test, stop one, and work out what went wrong (PRD E11.4). This version covers the local stack (Compose + kind). Staging and prod-like add Entra sign-in, EKS, CloudWatch and the DevOps-run Grafana (M7). Their parts are marked **TBD**.

## Emergency contacts

| When | Who | How |
| --- | --- | --- |
| Load must stop and the platform doesn't respond | BTB on-call engineer | **TBD** |
| Target is degraded or down during a run | Ticketing on-call (owner of the target) | **TBD** |
| Cluster, Prometheus, Grafana, or network problem | DevOps on-call | **TBD** |
| Payment sandbox limits or a charge that looks real | Ticketing payments owner | **TBD** |
| A run needs approval out of hours | Approvers of the environment (Admin -> People) | **TBD** |

Stop the load first, then call. Every stop path is listed below.

## Roles

| Role | Can |
| --- | --- |
| viewer | See runs, live view, results and reports |
| engineer | Create, edit, start and stop runs; set a baseline |
| approver | Approve or reject runs (not their own) |
| admin | Projects, targets, ceilings, environments, people, test data |

## Start the local stack

One command does all of this, ending with the web app: `pnpm dev:up` (see the root README). The steps, by hand:

```sh
docker compose -f infra/local/docker-compose.yml up -d          # Postgres, Redis, RedisInsight, MinIO, mock target
infra/kind/up.sh                                                # kind, k6 Operator, Prometheus, namespaces, guardrails, runner image
pnpm db:migrate && pnpm catalog:sync
docker compose -f infra/local/docker-compose.yml --profile worker up -d --build worker
docker compose -f infra/local/docker-compose.yml --profile grafana up -d grafana   # optional, http://localhost:3300
pnpm dev                                                         # web
```

The web app and the worker must share `LEASE_SECRET` (both have the same dev default). Set `GRAFANA_URL=http://localhost:3300` in `apps/web/.env.local` to get the Grafana link on finished runs.

## Run a test

1. **Create the run** (engineer): Runs -> New run. Pick the scenario version, environment, target, preset and, for checkout-like journeys, a release ID. The form checks the plan against policy as you type. A plan above a ceiling or on an outdated runner image can't be saved.
2. **Approval**: prod-like runs need two approvers. On staging, spike, stress and soak need one, and smoke, baseline and peak are approved by policy (`approversFor`). Approvers see the exact manifest hash they sign. Any edit after approval changes the hash and voids the approvals.
3. **Start** (engineer): Start re-checks approvals and policy (allowlist, ceilings, runner image), then the run goes to `queued`. The worker runs the rest of preflight before creating runners:

   | Check | Fails when | Fix |
   | --- | --- | --- |
   | approval | Approvals missing, expired, or for another hash. The stored manifest no longer matches its hash | Edit and submit again. A hash mismatch means someone changed the database: treat it as an incident |
   | target | The runner image is too old for the platform | Save a new scenario version on the current image |
   | window | Never yet: no blackout windows are configured | — |
   | test_data | The pool has 0 accounts, or the seed hook failed | Ask an admin to seed the pool; check the hook URL |
   | target_health | Health probe failed | Check the target with its owner before trying again |
   | monitoring | Prometheus isn't ready | `kubectl -n monitoring get pods` |
   | runner_capacity | Namespace quota can't fit the runners | Wait for the other run, or lower the load |

   A failed worker check puts the run back to `approved` with the reason. Nothing reaches the target. A missing test-data Secret is caught by the runners themselves (`policy_breach`, below).
4. **Running**: each runner pod checks the manifest hash and approvals itself before sending any load (timeline: `Runner verified`). The live view updates every 5 s.
5. **Finished**: results, verdict, caveats, artifacts and the HTML report are on the run page. Open Grafana from there for per-endpoint detail.

Only one run per target and two per namespace run at once. Other runs wait in the queue.

## Stop a run

Use the first path that works.

1. **Emergency stop in the app** (engineer and above): run page -> Emergency stop. The run goes to `stopping`, the worker deletes the runners, and the run ends `aborted` / `emergency_stop`. A queued run leaves the queue instead.
2. **Stop the worker** (web app unreachable): runners check in with the web app every 10 s. The web app answers "stop" when no worker heartbeat is in Redis, and runners stop themselves when no check-in succeeds for 60 s. So with the web app down, load stops within about 70 s by itself. With the worker down, it stops at the next check-in.
3. **Delete the runners by hand** (both down, or something is stuck):

   ```sh
   kubectl -n perf-staging delete testrun run-0123                      # TestRun name = run ID in lower case; or perf-prod
   kubectl -n perf-staging get pods -l k6_cr=run-0123                   # should be empty
   # Docker executor (dev only):
   docker ps --filter label=btb.io/run-id=RUN-0123 -q | xargs -r docker rm -f
   ```

   When the worker comes back it marks the run, and its orphan sweep deletes any runner without an active run.
4. **Cut the network** (last resort, DevOps): the runner namespaces have default-deny egress. Remove the target's allow rule. **TBD** on EKS (GitOps).

After any stop, check the target with its owner and write down the run ID and the time.

## Why a run aborted

| `abortReason` | Meaning | What to do |
| --- | --- | --- |
| `emergency_stop` | Someone pressed Emergency stop (timeline shows who) | Nothing, unless it was a mistake |
| `threshold` | A k6 threshold with `abortOnFail` broke (p95 or error rate over the budget) | Read the results; the target is slower than its budget |
| `target_health` | 3 health probes in a row failed during the run | Talk to the target owner before running again |
| `telemetry_lost` | No k6 metrics reached Prometheus for 60 s | Check Prometheus and the runners' remote-write; the numbers of this run are not trustworthy |
| `lease_expired` | Runners lost the platform and stopped themselves | Check the web app, the worker and the `btb-platform` link from the cluster |
| `policy_breach` | A runner refused to start: hash mismatch, approval revoked, manifest unreachable, test data missing. No load was sent | Read the timeline entry `Runner refused to start: ...` |
| `kubernetes_failure` | TestRun or pods failed (image pull, scheduling, crash, OOM) | `kubectl -n perf-staging describe pod ...`; Grafana -> Runner pod health |

## Verdict caveats

| Caveat | Meaning |
| --- | --- |
| `integrity_not_verified` | The target has no integrity endpoint, or it didn't answer. Oversold seats, double charges and charges without a ticket were not checked |
| `measurement_gap` | Telemetry had a gap of 15 s or more. Percentiles may miss that part of the run |
| `generator_saturated` | The generators were the bottleneck: a runner pod used ≥ 90 % of its CPU limit (1 min average; Kubernetes runners only, from cAdvisor), or k6 dropped more than 1 % of the planned iterations (open model, no free VU). Latency is inflated and the planned load may not have been sent. The timeline entry "Generator saturated" says which. Repeat with more runner pods (lower load per pod) |

## Troubleshooting

| Symptom | Look at | Likely cause |
| --- | --- | --- |
| Run stays `queued` | Worker logs: `docker compose -p btb-dev logs -f worker` | Worker down, or another run holds the target/namespace |
| `Runner refused to start: ... outdated` | Scenario version's image | The image predates the runner protocol. Save a new version on the current image |
| `Result callback missing` on the timeline | Runner pod log artifact | A pod finished without reporting. Results still come from Prometheus |
| `Integrity broken: ...` and verdict fail | The target's integrity endpoint, the run window | A real data problem in the target during the run. Escalate to the target owner |
| Live view empty while running | Prometheus: `k6_vus{testid="RUN-..."}`; Grafana k6 run dashboard | Remote-write blocked or Prometheus restarted |
| Runner pods OOMKilled | Grafana -> Runner pod health (memory of limit) | Load per pod too high, or a runner without `GOMEMLIMIT` (the worker sets it to 80 % of the limit). Lower the load or split it over more pods |
| `dropped_iterations` above 0 | Grafana -> k6 run -> Generator health | The generator couldn't keep up. The target saw less load than planned |
| Artifacts missing | MinIO console `http://localhost:19001`, bucket `btb-artifacts` | S3 settings in the worker; artifacts expire after 90 days |

Useful commands:

```sh
kubectl -n perf-staging get testruns,pods
kubectl -n perf-staging logs <pod> | tail -50
kubectl -n monitoring port-forward svc/prometheus 9091:9090
docker compose -f infra/local/docker-compose.yml exec postgres psql -U btb -d btb \
  -c "select at, actor_name, action, detail from audit_logs where run_id = 'RUN-0123' order by at"
```

## Capacity

Measured on kind with the runner pod's own resources (`docs/evidence/m5/calibration.md`, `browser-vus.md`). Repeat on EKS.

| Item | Value |
| --- | --- |
| Protocol VUs per runner pod | ~800 with 1 s think time; saturated at 1,200 (CPU at the limit, reported latency inflated) |
| Stable RPS per runner pod | ~2,400 (one request per iteration) |
| Load the platform puts on one pod | `LOAD_PER_RUNNER` = 200 VUs or iterations/s (wide margin; checkout at 200 VUs ≈ 430 rps) |
| Browser VUs per runner pod | 1 (`BROWSER_VUS_PER_POD`); one VU already uses 1.5 CPU, 6 VUs were OOM-killed |
| Runner pods per run | `WORKER_MAX_PARALLELISM` (default 4), capped by the executor |
| Runs at once | 1 per target, 2 per namespace |

## Dashboards

Grafana (compose profile `grafana`, folder BTB):

- **k6 run (native histograms)**: load, latency percentiles and heatmap, per-endpoint table, journey steps and funnel, generator health, and a run-vs-run table. Its whole-run numbers use the same queries as the run summary.
- **Runner pod health**: CPU and throttling, memory against the limit, OOM kills and network per runner pod. Needs the cAdvisor scrape from `infra/kind/manifests/30-monitoring.yaml`.
