#!/usr/bin/env bash
# Write kubeconfigs for apps/worker using the btb-worker ServiceAccount token (RBAC in manifests/40-worker-rbac.yaml).
#   .kube/worker.yaml       server https://btb-control-plane:6443  (worker container on the `kind` docker network)
#   .kube/worker-host.yaml  server from the kind-btb context         (worker started on the host: pnpm dev:worker)
# Output holds a token: gitignored, dev cluster only.
set -euo pipefail
cd "$(dirname "$0")"

CTX=kind-btb
kubectl --context "$CTX" -n btb-system wait --for=jsonpath='{.data.token}' secret/btb-worker-token --timeout=30s >/dev/null
TOKEN=$(kubectl --context "$CTX" -n btb-system get secret btb-worker-token -o jsonpath='{.data.token}' | base64 -d)
CA=$(kubectl --context "$CTX" -n btb-system get secret btb-worker-token -o jsonpath='{.data.ca\.crt}')
HOST_SERVER=$(kubectl config view --raw -o jsonpath="{.clusters[?(@.name==\"$CTX\")].cluster.server}")

write() {
  cat >"$1" <<EOF
apiVersion: v1
kind: Config
clusters:
  - name: btb
    cluster:
      server: $2
      certificate-authority-data: $CA
users:
  - name: btb-worker
    user:
      token: $TOKEN
contexts:
  - name: btb-worker
    context:
      cluster: btb
      user: btb-worker
current-context: btb-worker
EOF
  chmod 600 "$1"
}

mkdir -p .kube
write .kube/worker.yaml https://btb-control-plane:6443
write .kube/worker-host.yaml "$HOST_SERVER"
echo "Wrote infra/kind/.kube/worker.yaml and worker-host.yaml"
