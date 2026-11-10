#!/usr/bin/env bash
# calib-browser.sh VUS [STEP_SEC] [IMAGE] — N browser VUs in one pod with the browser runner's resources
# (apps/worker/src/plan.ts BROWSER_RUNNER_RESOURCES); samples CPU/memory every 5 s; prints the k6 summary lines.
set -euo pipefail
VUS=$1 STEP_SEC=${2:-60} IMAGE=${3:-btb-runner:0.1.0-0ffcce15e0}
NAME=calib-browser-$VUS
kubectl -n perf-staging delete pod "$NAME" --ignore-not-found >/dev/null
cat <<YAML | kubectl apply -f - >/dev/null
apiVersion: v1
kind: Pod
metadata: { name: $NAME, namespace: perf-staging, labels: { app: btb-calibration } }
spec:
  restartPolicy: Never
  containers:
    - name: k6
      image: $IMAGE
      imagePullPolicy: IfNotPresent
      args: ["run", "--tag", "testid=CALIB-browser-$VUS", "-o", "experimental-prometheus-rw", "/scripts/browser.js"]
      env:
        - { name: TARGET, value: "http://mock-calib.targets.svc.cluster.local:3000" }
        - { name: VUS, value: "$VUS" }
        - { name: STEP_SEC, value: "$STEP_SEC" }
        - { name: K6_PROMETHEUS_RW_SERVER_URL, value: "http://prometheus.monitoring.svc.cluster.local:9090/api/v1/write" }
        - { name: K6_FEATURES, value: "native-histograms" }
      resources: { requests: { cpu: 500m, memory: 512Mi }, limits: { cpu: 1500m, memory: 1Gi } }
      volumeMounts: [{ name: script, mountPath: /scripts }]
  volumes: [{ name: script, configMap: { name: calib-script } }]
YAML
kubectl -n perf-staging wait --for=condition=Ready "pod/$NAME" --timeout=120s >/dev/null
while [ "$(kubectl -n perf-staging get pod "$NAME" -o jsonpath='{.status.phase}')" = Running ]; do
  docker exec btb-control-plane crictl stats --output json 2>/dev/null | python3 -c '
import json,sys,time
for s in json.load(sys.stdin)["stats"]:
    a=s["attributes"]["labels"]
    if a.get("io.kubernetes.pod.name")=="'"$NAME"'" and a.get("io.kubernetes.container.name")=="k6":
        print(int(time.time()), int(s["cpu"]["usageNanoCores"]["value"])//1_000_000, "mCPU", int(s["memory"]["workingSetBytes"]["value"])//2**20, "MiB", flush=True)' 2>/dev/null || true
  sleep 5
done
echo "# $NAME phase=$(kubectl -n perf-staging get pod "$NAME" -o jsonpath='{.status.phase}') reason=$(kubectl -n perf-staging get pod "$NAME" -o jsonpath='{.status.containerStatuses[0].state.terminated.reason}')"
kubectl -n perf-staging logs "$NAME" 2>/dev/null | grep -E "browser_web_vital_lcp|iteration_duration|iterations\.|checks\.|page 200" | sed 's/^ *//'
