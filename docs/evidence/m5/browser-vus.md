# M5.2: k6 browser in a runner pod (PRD E0.4)

Date: 2026-11-08. `calib-browser.sh`: one pod with the browser runner's resources (`BROWSER_RUNNER_RESOURCES`:
requests 500m / 512Mi, limits 1500m / 1Gi), N Chromium VUs loading the mock event page in a loop (no think time),
60 s per level, against `mock-calib`. Raw logs: `calib-browser-<N>.log`.

| Browser VUs | Peak memory | Peak CPU | Pages/s | LCP median (p95) | Iteration median |
| --- | --- | --- | --- | --- | --- |
| 1 | 450 MiB | 1,492m | 1.41 | 104 ms (138) | 406 ms |
| 2 | 298 MiB | 1,506m | 1.38 | 156 ms (215) | 765 ms |
| 3 | 490 MiB | 1,504m | 1.29 | 216 ms (308) | 1.34 s |
| 4 | 677 MiB | 1,506m | 1.22 | 408 ms (411) | 2.0 s |
| 6 | **OOMKilled** at 1 Gi | | | | |

One VU already takes the pod's 1.5 CPU. More VUs add no throughput; they only queue on the CPU, so the vitals stop
describing the page (LCP ×4 at 4 VUs). **Max browser VUs per pod for valid measurements: 1.** That is what the worker
already does (`BROWSER_VUS_PER_POD = 1`, browser VUs = runner pods × 1); the constant is now documented as measured.
Policy needs no new rule: the browser VU count isn't a user input.

Other E0.4 points, from earlier runs:
- Browser test in a runner pod and vitals in Prometheus: `k6_browser_web_vital_*` per step, stored in
  `run_summaries.browser` (RUN-0053 … RUN-0104).
- Stadium 4G throttle works: same page, same target, LCP **489–534 ms** on Stadium 4G (RUN-0053, 0060, 0066, 0072,
  0104) vs **103–133 ms** on Wi-Fi baseline (RUN-0054, 0061, 0067, 0073).

Not measured: browser VUs with think time (a real journey waits between pages, so 1 VU doesn't keep the CPU busy).
More than one VU might then be valid; measure with the journey's own think time before raising the constant.
