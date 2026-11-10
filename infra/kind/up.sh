#!/usr/bin/env bash
# Create the local kind cluster with k6 Operator, guardrails and mock targets. Idempotent.
set -euo pipefail
cd "$(dirname "$0")"

CLUSTER=btb
K6_OPERATOR_VERSION=v1.7.0
CALICO_VERSION=v3.33.0

for bin in docker kind kubectl; do
  command -v "$bin" >/dev/null || { echo "missing required tool: $bin" >&2; exit 1; }
done

if ! kind get clusters | grep -qx "$CLUSTER"; then
  kind create cluster --config cluster.yaml
fi
kubectl config use-context "kind-$CLUSTER"

# Pool CIDR must match podSubnet in cluster.yaml (Calico's default 192.168.0.0/16 collides with home LANs).
curl -sfL --retry 3 "https://raw.githubusercontent.com/projectcalico/calico/${CALICO_VERSION}/manifests/calico.yaml" \
  | sed -e 's|# - name: CALICO_IPV4POOL_CIDR|- name: CALICO_IPV4POOL_CIDR|' \
        -e 's|#   value: "192.168.0.0/16"|  value: "10.244.0.0/16"|' \
  | kubectl apply --server-side -f -
kubectl -n kube-system rollout status ds/calico-node --timeout=300s
kubectl wait --for=condition=Ready nodes --all --timeout=120s

kubectl apply --server-side -f "https://raw.githubusercontent.com/grafana/k6-operator/${K6_OPERATOR_VERSION}/bundle.yaml"
kubectl -n k6-operator-system rollout status deploy/k6-operator-controller-manager --timeout=180s

docker build -t btb-mock-target:local ../mock-target
kind load docker-image btb-mock-target:local --name "$CLUSTER"

# Runner image (journeys bundle). Needs the pnpm workspace installed: `pnpm install` at the repo root.
(cd ../../journeys && pnpm run image)

kubectl apply -f manifests/
kubectl -n perf-staging create configmap btb-smoke --from-file=smoke.js=../k6/smoke.js --dry-run=client -o yaml | kubectl apply -f -
kubectl -n targets rollout status deploy/mock-target deploy/unapproved-target --timeout=120s
kubectl -n monitoring rollout status deploy/prometheus --timeout=120s
./worker-kubeconfig.sh
./platform-link.sh

echo "Ready. Run a test: kubectl apply -f infra/kind/testrun.yaml"
