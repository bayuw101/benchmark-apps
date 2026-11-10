#!/usr/bin/env bash
# calib-pod.sh MODE STEPS [STEP_SEC] [IMAGE] — run one calibration pod to completion, sampling its CPU/memory every 5 s.
# K6_EXTRA=--summary-mode=disabled adds one k6 flag (testid gets a -x suffix). NO_OUT=" " drops the Prometheus output. GOMEMLIMIT=200MiB sets the Go soft memory limit.
set -euo pipefail
MODE=$1 STEPS=$2 STEP_SEC=${3:-60} IMAGE=${4:-btb-runner:0.1.0-0ffcce15e0}
NAME=calib-$MODE
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
      args: ["run", "--tag", "testid=CALIB-$MODE${K6_EXTRA:+-x}"${NO_OUT:-, "-o", "experimental-prometheus-rw"}${K6_EXTRA:+, "$K6_EXTRA"}, "/scripts/calib.js"]
      env:
        - { name: TARGET, value: "http://mock-calib.targets.svc.cluster.local:3000" }
        - { name: MODE, value: "$MODE" }
        - { name: STEPS, value: "$STEPS" }
        - { name: STEP_SEC, value: "$STEP_SEC" }
        - { name: K6_PROMETHEUS_RW_SERVER_URL, value: "http://prometheus.monitoring.svc.cluster.local:9090/api/v1/write" }
        - { name: K6_PROMETHEUS_RW_PUSH_INTERVAL, value: "5s" }
        - { name: K6_FEATURES, value: "native-histograms" }
        - { name: GOMEMLIMIT, value: "${GOMEMLIMIT:-}" }
      resources: { requests: { cpu: 100m, memory: 128Mi }, limits: { cpu: 500m, memory: 256Mi } }
      volumeMounts: [{ name: script, mountPath: /scripts }]
  volumes: [{ name: script, configMap: { name: calib-script } }]
YAML
kubectl -n perf-staging wait --for=condition=Ready "pod/$NAME" --timeout=120s >/dev/null
echo "# $NAME started $(date -u +%s)"
while [ "$(kubectl -n perf-staging get pod "$NAME" -o jsonpath='{.status.phase}')" = Running ]; do
  docker exec btb-control-plane crictl stats --output json 2>/dev/null | python3 2>/dev/null -c '
import json,sys,time
for s in json.load(sys.stdin)["stats"]:
    a=s["attributes"]
    if a["labels"].get("io.kubernetes.pod.name")=="'"$NAME"'" and a["labels"].get("io.kubernetes.container.name")=="k6":
        print(int(time.time()), int(s["cpu"]["usageNanoCores"]["value"])//1_000_000, "mCPU", int(s["memory"]["workingSetBytes"]["value"])//2**20, "MiB", flush=True)' || true
  sleep 5
done
echo "# $NAME ended $(date -u +%s) phase=$(kubectl -n perf-staging get pod "$NAME" -o jsonpath='{.status.phase}') exit=$(kubectl -n perf-staging get pod "$NAME" -o jsonpath='{.status.containerStatuses[0].state.terminated.exitCode}') reason=$(kubectl -n perf-staging get pod "$NAME" -o jsonpath='{.status.containerStatuses[0].state.terminated.reason}')"
