#!/usr/bin/env python3
"""M5.6 (PRD E11.2): the run page's request total and error rate (worker PromQL) vs the k6 summaries.

usage: compare_totals.py PROM_URL RUN_ID END_EPOCH WINDOW_SEC k6-summary-*.json

k6 side: `http_req_failed{scenario:<journey>}` (a Rate: fails = failed requests, passes = good ones), summed over the
runner pods, so lease check-ins and platform calls are left out like in the worker's queries.
"""
import json, sys, urllib.parse, urllib.request

prom, run_id, end, window, files = sys.argv[1], sys.argv[2], float(sys.argv[3]), int(sys.argv[4]), sys.argv[5:]
sel = lambda extra="": f'{{testid="{run_id}",scenario!~"btb-lease|btb-browser",name!~"btb-.*"{extra}}}'

def scalar(q):
    data = urllib.parse.urlencode({"query": q, "time": str(end)}).encode()
    r = json.load(urllib.request.urlopen(f"{prom}/api/v1/query", data, timeout=15))["data"]["result"]
    return float(r[0]["value"][1]) if r else 0.0

p_total = scalar(f"sum(max_over_time(k6_http_reqs_total{sel()}[{window}s]))")
p_failed = scalar(f"sum(max_over_time(k6_http_reqs_total{sel(',expected_response=\"false\"')}[{window}s]))")
k_fail = k_pass = 0
for f in files:
    m = json.load(open(f))["metrics"]
    v = next(v for k, v in m.items() if k.startswith("http_req_failed{scenario:"))["values"]
    k_fail += v["fails"] if "fails" in v else 0
    k_pass += v["passes"] if "passes" in v else 0
# k6 Rate: "passes" counts true values = failed requests; "fails" counts false = good requests.
k_total, k_failed = k_fail + k_pass, k_pass
pct = lambda a, b: abs(a - b) / b * 100 if b else 0.0
print(f"| {run_id} | requests | {k_total:.0f} | {p_total:.0f} | {pct(p_total, k_total):.2f}% |")
print(f"| {run_id} | failed | {k_failed:.0f} | {p_failed:.0f} | {abs(p_failed - k_failed):.0f} |")
print(f"| {run_id} | error rate | {k_failed / k_total * 100 if k_total else 0:.3f}% | {p_failed / p_total * 100 if p_total else 0:.3f}% | |")
