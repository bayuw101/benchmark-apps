#!/usr/bin/env bash
# Lets runner pods reach the web app on the host for the runner lease (E6.1): a selectorless Service
# btb-platform.btb-system pointing at the kind network gateway, plus the egress rule the runners need.
# Idempotent. WEB_PORT is where `pnpm dev` listens (Next picks 3001 when 3000 is taken).
set -euo pipefail

WEB_PORT="${WEB_PORT:-3001}"
GATEWAY="$(docker network inspect kind -f '{{range .IPAM.Config}}{{.Gateway}} {{end}}' | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | head -n1)"
[[ -n "$GATEWAY" ]] || { echo "no IPv4 gateway on the kind docker network" >&2; exit 1; }

policy() {
  cat <<EOF
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: runner-lease-egress
  namespace: $1
spec:
  podSelector: {}
  policyTypes: ["Egress"]
  egress:
    - to:
        - ipBlock:
            cidr: ${GATEWAY}/32
      ports:
        - protocol: TCP
          port: ${WEB_PORT}
EOF
}

{
  cat <<EOF
apiVersion: v1
kind: Service
metadata:
  name: btb-platform
  namespace: btb-system
spec:
  ports:
    - name: http
      port: 80
      targetPort: ${WEB_PORT}
---
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: btb-platform-host
  namespace: btb-system
  labels:
    kubernetes.io/service-name: btb-platform
addressType: IPv4
ports:
  - name: http
    port: ${WEB_PORT}
endpoints:
  - addresses: ["${GATEWAY}"]
EOF
  policy perf-staging
  policy perf-prod
} | kubectl apply -f -

echo "btb-platform -> ${GATEWAY}:${WEB_PORT}"
