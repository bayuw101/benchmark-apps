# M5.3: generator calibration, one runner pod (PRD E0.6)

Date: 2026-11-08. A plain pod in `perf-staging` with the runner image (`btb-runner:0.1.0-0ffcce15e0`, k6 2.3.0) and
exactly the runner pod's resources (`RUNNER_RESOURCES`: requests 100m / 128Mi, limits 500m / 256Mi), against
`mock-calib` (`mock-calib.yaml`: same mock image, 2 CPU, 20 ms latency, so the generator saturates first).
Script and pod: `calibration.yaml`, `calib-pod.sh` (CPU and working-set memory from `crictl stats` every 5 s; rates,
dropped iterations and latency from the cluster Prometheus under `testid=CALIB-*`). Raw logs: `calib-*.log`.

## Request rate (ramping-arrival-rate, one GET per iteration)

| Step | Achieved | Dropped | Notes |
| --- | --- | --- | --- |
| 200 → 1,600 /s | = target | 0 | CPU ≤ 250m |
| 2,400 /s | 2,396–2,399 /s | 5 /s for one 15 s interval while ramping | |
| 3,200 /s | | | run 1: **OOMKilled** (256Mi) while ramping to 3,200 |
| 1,600 → 3,200 /s (run 2) | = target | 0 | completed; CPU ~350m; memory 107 → 213 MiB |

## Memory grows with requests, not with rate

| Run (1,000 /s constant) | Memory |
| --- | --- |
| no GOMEMLIMIT, 10 min | 84 → 170 MiB, still climbing (~165 bytes per request) |
| `--summary-mode=disabled`, 5 min | 85 → 131 MiB (same slope: not the end-of-test summary) |
| no Prometheus output, 5 min | 72 → 121 MiB (same slope: not remote write) |
| **GOMEMLIMIT=150MiB, 12 min** | 86 → 148 MiB by minute 8, then **flat at 148–149 MiB**; 0 dropped, CPU ~200m |
| GOMEMLIMIT=200MiB, ladder 200 → 3,200 /s | completed, peak 197 MiB (the ladder that OOM-killed run 1) |

So it is Go heap the runtime didn't collect: without `GOMEMLIMIT` Go doesn't know the cgroup limit and lets the heap
grow until the pod is OOM-killed. At ~1,000 requests/s a pod would have died after roughly 15–20 minutes; a soak (4 h)
would not survive. **Fixed**: the worker now sets `GOMEMLIMIT` to 80 % of the pod's memory limit (204MiB protocol,
819MiB browser) on TestRun runners and Docker runners (`goMemLimit` in apps/worker/src/plan.ts).

## VUs (GET + sleep 1 s per iteration; one pod per level)

k6 allocates every VU of a scenario at start, so a ramp to 2,400 VUs was OOM-killed within 10 s.

| VUs | Achieved | Iteration p95 | HTTP p95 | Peak memory | Peak CPU |
| --- | --- | --- | --- | --- | --- |
| 400 | 392 rps (ideal 392) | 1.09 s | 22 ms | 127 MiB | 69m |
| 800 | 775 rps (ideal 784) | 1.09 s | 22 ms | 193 MiB | 172m |
| 1,200 | 1,063 rps (ideal 1,176) | 1.27 s | **179 ms** | 223 MiB | **499m (limit)** |

At 1,200 VUs the generator is saturated: throughput drops to 90 % and the latency it reports is inflated eightfold
(the target still answers in ~20 ms). That is exactly the case the `generator_saturated` caveat exists for.

## The caveat in the product (2026-11-09)

The worker now puts `generator_saturated` on the verdict when a runner pod's CPU (1 min average, cAdvisor) reaches
90 % of its limit, or when k6 drops more than 1 % of the planned iterations (`saturationOf` in apps/worker/src/plan.ts),
and adds a "Generator saturated" timeline entry with the reason.

| Run | Load | Runner CPU peak | Caveat |
| --- | --- | --- | --- |
| RUN-0200 | Browse event v7 (protocol, no think time), 200 VUs on 1 pod vs `mock-calib`, stopped after 3 min | 500m of 500m | `generator_saturated`: "A runner pod used 100% of its CPU limit"; p95 157 ms against a 20 ms target |
| RUN-0201 | Browse event v6 smoke, browser (Wi-Fi baseline), 1 pod | 488m of 1,500m | none, verdict pass |

## Conclusion

One runner pod (500m / 256Mi) is stable up to **~2,400 requests/s** (arrival rate, single request) and **~800 VUs**
with 1 s think time. The binding limits are CPU (~1,000 VUs) and memory (allocated VUs, and heap growth, now capped).
`LOAD_PER_RUNNER = 200` (VUs or iterations/s per pod) keeps a wide margin: real journeys are heavier than this probe
(checkout: 5 requests and polling per iteration; RUN-0182 ran 200 VUs per pod at ~430 rps each). Keep 200.
