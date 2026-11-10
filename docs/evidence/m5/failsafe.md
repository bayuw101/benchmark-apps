# M5.5: fail-safe matrix (PRD E11.1)

Date: 2026-11-08, kind. Every case is a real platform run of Checkout v7 (image `btb-runner:0.1.0-0ffcce15e0`),
baseline preset on `mock-target-prod` (prod-like, 2 approvals, 10 VUs, 15 min planned) unless noted. Faults that
change the network were injected in `perf-prod` only, so runs in `perf-staging` were never affected.
Pass = the load stops and the run ends with the reason on its timeline.

| Case | How it was injected | Load stopped | Run ended | Reason recorded | Result |
| --- | --- | --- | --- | --- | --- |
| Dashboard down | RUN-0188: the only live viewer (SSE client) killed 40 s in; 60 s with no viewer; then `POST /api/runs/RUN-0188/stop` (no dashboard) | at the stop | 1:35 after start | `emergency_stop`: "TestRun deleted; its runner pods are removed with it" | PASS |
| Web app down | RUN-0184: `runner-lease-egress` deleted in `perf-prod` 24 s after the runners started (runners can't reach the web app) | ~60 s later (lease grace) | 66 s after the cut | `lease_expired`: "A runner lost its lease and stopped the load" + "Result callback missing" (the web app was unreachable) | PASS |
| Worker down | RUN-0189: compose worker stopped 15 s after the runners started; restarted 2:10 later (no other run was active) | 32 s after the stop: the lease answers "no worker is watching" once the worker heartbeat expires; runner exits 108 | when the worker came back (it can't write while down) | `lease_expired`: "A runner stopped the load (lease: no worker is watching the run)" | PASS |
| One pod dies | RUN-0183: runner pod force-deleted 27 s after it started. Retest after the fix: RUN-0194 (1 pod) and RUN-0195 (2 pods, one deleted) | at once (the pod is gone; its Job doesn't restart it); RUN-0195: the other pod deleted by the worker 2 s later | RUN-0183: 62 s after. RUN-0194: 4 s, RUN-0195: 2 s | RUN-0183: `telemetry_lost`. After the fix: `kubernetes_failure`: "1 of 2 runner pods disappeared (deleted or evicted) before the run ended; any other runners were stopped." | PASS |
| Telemetry lost | RUN-0187: `iptables -I FORWARD -s <runner pod> -d <prometheus pod> -j DROP` on the kind node 25 s after start | at the abort (TestRun deleted) | 63 s after the cut | `telemetry_lost`: "No runner telemetry for 62 s (limit 60 s); the load was stopped" | PASS |

Notes
- Worker down: the load stops without the worker (runner + web app + Redis heartbeat); the record waits for the
  worker. Until then the run page still says `running`. Acceptable: nothing is sending load, and the reason the
  runner gave (signed callback) is what ends up on the run.
- Dashboard down: while nobody watched, the run kept its guards (telemetry 3 s old at the 60 s mark), so a closed
  browser tab neither stops nor unguards a run, and stopping doesn't need the dashboard.
- One pod dies (RUN-0183, before the fix): safe, but the reason said telemetry, not "a runner pod died"; the worker
  only noticed through the telemetry guard (60 s). The killed pod also reported "Runner finished … thresholds
  held", because k6 runs `handleSummary` on SIGTERM.
- Fixed 2026-11-09 (runner image `0.1.0-3b15fc3873`, Checkout v8):
  - The worker reads the runner pods while the TestRun is `started` and `finished`. A pod that is gone, or that
    exited with a code a runner doesn't end with by itself (not 0, 99 or 108; e.g. 137 OOM), fails the run at
    once and the rest are deleted (`runnerDied` in `apps/worker/src/plan.ts`). k6-operator flips the TestRun to
    `finished` the moment its only pod is deleted (RUN-0193), so both stages are checked.
  - A pod that ends more than 5 s short of its planned duration with its thresholds holding reports `stopped`
    ("interrupted after 18 s of the planned 900 s") instead of `finished` (`finalCallback` in k6-lib). A threshold
    abort also ends early, and still reports `finished`, thresholds crossed.
- Telemetry lost: the first attempt (RUN-0186) removed the Prometheus egress rule instead, and nothing happened: the
  runner's keep-alive connection survived the policy change (see guardrails.md). Dropping the packets on the node
  is what a real network partition looks like.
- Before the fix, both "pod dies" and "worker down" showed a misleading `finished … thresholds held` callback after a
  stop; with the new runner image they show `Runner stopped the load: … interrupted after N s`.
- After every case the original NetworkPolicies / iptables were restored and checked.
