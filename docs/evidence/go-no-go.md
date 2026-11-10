# Go / no-go after the spike (PRD E0.9)

**Status: draft recommendation for the lead (PRD D21: the lead writes the decision).** Evidence: `m5/README.md`.
Date: 2026-11-08. All measurements on the local kind cluster, not on EKS.

## Criteria

| Spike item | Criterion (PRD) | Result | Verdict |
| --- | --- | --- | --- |
| E0.3 percentiles | Native-histogram percentiles match the k6 summary; metric names and PromQL documented; native-histogram flag status known | ≤ 0.6 % on realistic runs (1 and 2 pods, 689,905 requests); 3.7 % on a near-constant distribution; queries in `m5/quantiles.md`; Prometheus v3.5.0 with `--enable-feature=native-histograms` | Met |
| E0.4 k6 browser | Browser test in a runner pod, vitals in Prometheus, Stadium 4G throttle proven, max browser VUs per pod measured | All four; max = 1 per pod (1.5 CPU) | Met |
| E0.6 generator calibration | Capacity of one runner pod measured | ~2,400 rps / ~800 VUs per pod; `LOAD_PER_RUNNER = 200` has a wide margin | Met |
| E0.8 SSE | Stable on long runs through Next.js standalone | 65 min, one connection, no gaps | Met (no ingress in front) |
| E0.8 k6 REST API | Enabled for clean stops | Replaced by lease abort + TestRun delete (decided 2026-11-08, option B); both proven | Met by design change |
| E0.8 Fluent Bit | No dropped logs under saturation | No log aggregation in the stack | Not applicable yet |
| E0.8 staging DB for integrity | Exists or not | Not yet (TBD-13); integrity proven against the mock's read-only endpoint | Known: no |
| E11.1 fail-safe | Run stops safely: dashboard, web, worker, pod, telemetry | 5/5: load stops, reason recorded | Met |
| E11.2 measurement | Dashboard and Grafana match the k6 summary | Run page and Grafana: exact for requests and error rate, percentiles as E0.3 (Grafana measured 2026-11-09 on 49 runs) | Met |
| E11.3 / E6.7 guardrails | NetworkPolicy blocks unapproved targets; quota holds regardless of app policy | Both, in both runner namespaces | Met |

## Found and fixed during M5

- Runner pods could be OOM-killed on long or busy runs: k6's Go heap grew until the 256Mi limit (~165 bytes per
  request at 1,000 rps, a soak would not survive). The worker now sets `GOMEMLIMIT` to 80 % of the pod's memory
  limit; with it, memory levels off under the limit (12 min at 1,000 rps flat at 148 MiB with a 150 MiB limit).
- The production web image didn't build (`vite` import in `vitest.config.ts`, `S3_BUCKET` read at import). Fixed.

## Risks and open items (not blocking)

1. Everything ran on kind. Repeat M5.1, M5.3 and the fail-safe matrix on EKS before the pilot (node types, CNI and
   ALB differ).
2. Decision no. 4 ("matching" threshold), decided 2026-11-09: ≤ 5 % or ≤ 1 ms, whichever is larger (native-histogram
   bucket width makes 5 % alone too tight for near-constant latencies).
3. Fixed 2026-11-09: a dead runner pod now fails the run within seconds with its own reason (RUN-0194, RUN-0195),
   and a pod cut off mid-run reports "stopped … interrupted" instead of "finished, thresholds held".
4. NetworkPolicy edits don't cut established connections (Calico). Fine for a fixed per-run allowlist; don't treat a
   policy edit as a kill switch.
5. SSE behind the real ingress / ALB not tested.
6. Browser VUs with think time not measured; until they are, keep 1 per pod.
7. Log aggregation (Fluent Bit) isn't in the stack; its E0.8 check is pending, not failed.
8. Fixed 2026-11-09: peak RPS of a stopped run missed the final push on the run page (RUN-0188: 26 vs 28 rps in
   Grafana); the worker now waits one push interval after a stop (RUN-0200 matches).

## Recommendation

**Go**, with items 1 and 2 done before the pilot. No criterion failed; the items not covered are either not built
or not deployed yet (Fluent Bit, staging DB access) or need the real environment (EKS, ingress).
