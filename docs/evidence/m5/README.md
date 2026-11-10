# M5 evidence: spike proofs and validation

Collected 2026-11-08 on the local kind cluster (Calico, k6-operator v1.7.0, Prometheus v3.5.0) with runner image
`btb-runner:0.1.0-0ffcce15e0` (k6 2.3.0). Every claim has a run ID or a log file here. Decision summary:
[`../go-no-go.md`](../go-no-go.md).

| Item | PRD | Result | Evidence |
| --- | --- | --- | --- |
| M5.1 percentiles: native histograms vs k6 summary | E0.3, E11.2 | Met: ≤ 0.6 % on realistic distributions; 3.7 % on a near-constant one (bucket width) | quantiles.md |
| M5.2 max browser VUs per pod | E0.4 | 1 (one VU saturates 1.5 CPU; more VUs inflate vitals); Stadium 4G throttle proven | browser-vus.md |
| M5.3 generator calibration | E0.6 | ~2,400 rps or ~800 VUs per pod; found and fixed an OOM (GOMEMLIMIT) | calibration.md |
| M5.4 SSE on a long run | E0.8 | 65 min, one connection, ticks every 5.0 s, standalone build | sse.md |
| M5.5 fail-safe matrix | E11.1 | 5/5 stop the load and record a reason | failsafe.md |
| M5.6 dashboard numbers vs k6 summary | E11.2 | Exact for requests and error rate, on the run page and in Grafana (49 runs); peak RPS of a stopped run slightly low on the run page | quantiles.md |
| M5.7 NetworkPolicy + ResourceQuota | E11.3, E6.7 | Hold in both runner namespaces | guardrails.md |

Reproduce: `kubectl apply -f mock-calib.yaml -f calibration.yaml`, then the scripts (`calib-pod.sh`,
`calib-browser.sh`, `compare_quantiles.py`, `compare_totals.py`, `sse_watch.py`). Targets `calib-mock` and `sse-mock`
exist in the local database for these runs; `mock-calib` was removed from the cluster afterwards.
