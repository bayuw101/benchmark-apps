#!/usr/bin/env python3
"""M5.1 (PRD E0.3/E11.2): p50/p95/p99 from Prometheus native histograms vs the k6 end-of-test summary.

usage: compare_quantiles.py PROM_URL RUN_ID END_EPOCH WINDOW_SEC k6-summary-1.json [k6-summary-2.json ...]

Per runner pod: histogram_quantile over that pod's series (instance_id = pod index) vs the same pod's k6 summary
(`http_req_duration{scenario:<journey>}`, i.e. the journey's requests only, like the worker's PromQL). One pod also
gets the whole-run figure the worker stores. Prints a markdown table; exit 1 if any difference is over LIMIT_PCT.
"""
import json, sys, urllib.parse, urllib.request

LIMIT_PCT = 5.0  # PROPOSAL (plan M5.1)
QS = [("p50", "0.5", "med"), ("p95", "0.95", "p(95)"), ("p99", "0.99", "p(99)")]

prom, run_id, end, window, files = sys.argv[1], sys.argv[2], float(sys.argv[3]), int(sys.argv[4]), sys.argv[5:]

def query(q):
    data = urllib.parse.urlencode({"query": q, "time": str(end)}).encode()
    res = json.load(urllib.request.urlopen(f"{prom}/api/v1/query", data, timeout=15))["data"]["result"]
    return {r["metric"].get("instance_id", ""): float(r["value"][1]) for r in res}

sel = f'{{testid="{run_id}",scenario!~"btb-lease|btb-browser",name!~"btb-.*"}}'
prom_by_pod = {k: query(f"histogram_quantile({q}, sum by (instance_id) (last_over_time(k6_http_req_duration_seconds{sel}[{window}s]))) * 1000") for k, q, _ in QS}
prom_all = {k: query(f"histogram_quantile({q}, sum(last_over_time(k6_http_req_duration_seconds{sel}[{window}s]))) * 1000").get("") for k, q, _ in QS}

rows, worst = [], 0.0
for i, f in enumerate(files, start=1):
    metrics = json.load(open(f))["metrics"]
    key = next(k for k in metrics if k.startswith("http_req_duration{scenario:"))
    vals = metrics[key]["values"]
    for k, _, stat in QS:
        # Docker runners have no instance_id label (k6-operator sets it): one pod = the unlabelled series.
        k6v, pv = vals[stat], prom_by_pod[k].get(str(i), prom_by_pod[k].get("") if len(files) == 1 else None)
        diff = abs(pv - k6v) / k6v * 100 if pv is not None and k6v else float("nan")
        worst = max(worst, diff)
        rows.append(f"| {run_id} | pod {i} | {k} | {k6v:.1f} | {pv:.1f} | {diff:.2f}% |")
if len(files) == 1:
    vals = json.load(open(files[0]))["metrics"]
    vals = next(v for k, v in vals.items() if k.startswith("http_req_duration{scenario:"))["values"]
    for k, _, stat in QS:
        rows.append(f"| {run_id} | whole run | {k} | {vals[stat]:.1f} | {prom_all[k]:.1f} | {abs(prom_all[k] - vals[stat]) / vals[stat] * 100:.2f}% |")

print("| Run | Scope | Stat | k6 summary (ms) | Prometheus (ms) | Diff |")
print("| --- | --- | --- | --- | --- | --- |")
print("\n".join(rows))
print(f"\nWorst difference: {worst:.2f}% (limit {LIMIT_PCT}%)")
sys.exit(0 if worst <= LIMIT_PCT else 1)
