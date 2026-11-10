#!/usr/bin/env python3
"""M5.6 (PRD E11.2): the Grafana "Selected runs over the time range" table vs the run page (`run_summaries`).

usage: compare_grafana.py GRAFANA_URL USER:PASSWORD < runs.tsv
runs.tsv: run_id, started_at epoch, ended_at epoch, p50, p95, p99, error_rate_pct, peak_rps (tab-separated)

Queries go through Grafana's datasource proxy with the panel's own expressions, `$testid` = the run and the time
range the run page's Grafana link opens (start - 60 s .. end + 60 s), so `$__range` is that span.
"""
import base64, json, sys, urllib.parse, urllib.request

grafana, auth = sys.argv[1].rstrip("/"), base64.b64encode(sys.argv[2].encode()).decode()
panel = next(
    p for p in json.load(open("infra/grafana/dashboards/btb-k6-run.json"))["panels"]
    if p.get("title") == "Selected runs over the time range"
)
exprs = {t["refId"]: t["expr"] for t in panel["targets"]}

def query(expr, at):
    url = f"{grafana}/api/datasources/proxy/uid/btb-prometheus/api/v1/query"
    data = urllib.parse.urlencode({"query": expr, "time": str(at)}).encode()
    req = urllib.request.Request(url, data, {"Authorization": f"Basic {auth}"})
    res = json.load(urllib.request.urlopen(req, timeout=30))["data"]["result"]
    return float(res[0]["value"][1]) if res else None

print("| Run | p50 page / Grafana | p95 page / Grafana | p99 page / Grafana | Error % page / Grafana | Peak RPS page / Grafana | Requests (Grafana) |")
print("| --- | --- | --- | --- | --- | --- | --- |")
for line in sys.stdin:
    run, start, end, p50, p95, p99, err, peak = line.rstrip("\n").split("\t")
    frm, to = float(start) - 60, float(end) + 60
    g = {
        ref: query(e.replace('"$testid"', f'"{run}"').replace("$__range", f"{int(to - frm)}s"), to)
        for ref, e in exprs.items()
    }
    if g["D"] is None:
        print(f"| {run} | no data in Prometheus | | | | | |")
        continue
    ms = lambda v: f"{v * 1000:.0f}" if v is not None else "-"
    print(
        f"| {run} | {p50} / {ms(g['A'])} | {p95} / {ms(g['B'])} | {p99} / {ms(g['C'])} "
        f"| {float(err):.3f} / {g['E']:.3f} | {peak} / {g['F']:.0f} | {g['D']:.0f} |"
    )
