# M5.1 / M5.6: measured numbers vs the k6 summary (PRD E0.3, E11.2)

Date: 2026-11-08. kind, Prometheus `prom/prometheus:v3.5.0` with `--enable-feature=native-histograms` and
`--web.enable-remote-write-receiver`; runners `btb-runner:0.1.0-0ffcce15e0` (k6 2.3.0) with `K6_FEATURES=native-histograms`.

## What is compared

| Run page number | Platform source | k6 summary source |
| --- | --- | --- |
| p50 / p95 / p99 | `histogram_quantile(q, sum(last_over_time(k6_http_req_duration_seconds{testid,scenario!~"btb-lease|btb-browser",name!~"btb-.*"}[window])))` (apps/worker/src/plan.ts `summaryQueries`) | `http_req_duration{scenario:<journey>}` med / p(95) / p(99) |
| Requests | `sum(max_over_time(k6_http_reqs_total{…}[window]))` | `http_req_failed{scenario:<journey>}` passes + fails |
| Error rate | failed (`expected_response="false"`) / requests | `http_req_failed{scenario:<journey>}` passes / total |

Window = achieved duration + 30 s, evaluated at the run's end, as the worker does. Per runner pod: same query
`sum by (instance_id)`, against that pod's own summary (percentiles of two pods can't be merged from summaries).
Scripts: `compare_quantiles.py`, `compare_totals.py` (raw output: `quantiles-output.txt`, `totals-output.txt`).

## Percentiles

| Run | Shape | Pods | Worst difference |
| --- | --- | --- | --- |
| RUN-0177 | smoke, latency 20–500 ms (uniform jitter) | 1 | 0.47 % (p95 475.6 vs 477.8 ms) |
| RUN-0182 | peak 400 VUs, same jitter, 15 min, 689,905 requests | 2 | 0.16 % |
| RUN-0164 | smoke via the Docker executor, ~1 ms latency | 1 | 0.59 % |
| RUN-0167 | smoke, latency fixed at ~21 ms | 1 | **3.71 %** (p95 21.2 vs 22.0 ms) |

The values stored in `run_summaries` (what the run page shows) equal the Prometheus side: RUN-0177 269/478/496 ms,
RUN-0182 261/477/496 ms.

Why RUN-0167 is close to the limit: k6 writes native histograms with schema 3, buckets growing by 2^(1/8) = 1.0905
(read from the stored histogram: 18.58 → 20.26 → 22.10 ms). When nearly every sample falls into one or two buckets,
`histogram_quantile` interpolates inside a 9 % wide bucket, so the error can approach the bucket width. Here that is
0.8 ms. Wide, realistic distributions stay under 0.6 %.

## Requests and error rate (E11.2)

| Run | Requests k6 / platform | Failed k6 / platform | Error rate |
| --- | --- | --- | --- |
| RUN-0177 | 1,277 / 1,277 | 0 / 0 | 0 % |
| RUN-0182 | 689,905 / 689,905 | 0 / 0 | 0 % |
| RUN-0167 | 2,555 / 2,555 | 0 / 0 | 0 % |
| RUN-0148 | 2,547 / 2,547 | 8 / 8 | 0.314 % both (run page 0.314 %) |

Exact. Peak RPS has no k6 summary counterpart (the summary only has the average rate), so it isn't compared.

## Grafana vs the run page (E11.2, measured 2026-11-09)

The `btb-k6-run` dashboard's "Selected runs over the time range" table, queried through Grafana's datasource proxy
with the panel's own expressions and the time range the run page's Grafana link opens (start - 60 s .. end + 60 s).
Script: `compare_grafana.py`; raw output for all 49 runs still in Prometheus: `grafana-output.txt`.

| Run | p50 / p95 / p99 ms, page = Grafana | Error rate | Peak RPS page / Grafana | Requests in Grafana (k6 summary) |
| --- | --- | --- | --- | --- |
| RUN-0177 | 269 / 478 / 496 | 0 % both | 11 / 11 | 1,277 (1,277) |
| RUN-0182 | 261 / 477 / 496 | 0 % both | 855 / 855 | 689,905 (689,905) |
| RUN-0167 | 21 / 22 / 22 | 0 % both | 21 / 21 | 2,555 (2,555) |
| RUN-0148 | 21 / 22 / 22 | 0.314 % both | 22 / 22 | 2,547 (2,547) |
| RUN-0188 | 21 / 22 / 22 | 0 % both | **26 / 28** | 1,483 |

Percentiles, error rate and request totals: identical in all 49 runs, so Grafana matches the k6 summary exactly as
far as the run page does. Peak RPS: identical in 48 runs. RUN-0188 (stopped by hand) differs because its last push
landed 5 s after `ended_at`, and the worker evaluates the summary at `ended_at`; Grafana's range includes 60 s more.
So for a stopped run the run page can miss the final push (here 28 vs 26 rps). **Fixed 2026-11-09**: after an
emergency stop the worker waits one push interval (+1 s) and evaluates the summary there. RUN-0200 (stopped by hand):
last push 0.75 s after `ended_at`, peak RPS 2,557 on the page and in Prometheus.

## Conclusion

- E0.3 met: percentiles from native histograms match the k6 summary within 0.6 % on realistic distributions.
- E11.2 met for the dashboard (run page) and Grafana: percentiles, request totals and error rate. Peak RPS of a
  stopped run could be a few percent low on the run page (RUN-0188, see above); fixed.
- Decision no. 4 (what counts as "matching"), decided 2026-11-09: **≤ 5 % or ≤ 1 ms, whichever is larger**. A pure
  5 % rule is too tight for very narrow distributions (bucket width ~9 %), where the absolute difference is under a
  millisecond.
- Not built (decided 2026-11-09): the optional automatic caveat when platform and summary disagree (M5.6, PROPOSAL).
  No run has disagreed since the peak RPS fix, and it needs the per-pod k6 summaries parsed in the worker. Revisit if
  the EKS repeat of M5.1 shows a gap.
