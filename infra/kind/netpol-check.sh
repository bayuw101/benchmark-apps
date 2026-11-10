#!/usr/bin/env bash
# E0.5: from a runner namespace, the approved target must be reachable; anything else must be blocked.
# Usage: netpol-check.sh [namespace]   (default perf-staging)
set -euo pipefail
NS=${1:-perf-staging}

probe() {
  kubectl -n "$NS" run "netpol-probe-$1" --rm -i -q --restart=Never \
    --image=curlimages/curl:8.11.1 --command -- \
    curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$2"
}

fail=0
if code=$(probe approved http://mock-target.targets.svc.cluster.local:3000/healthz); then
  echo "PASS approved target reachable (HTTP $code)"
else
  echo "FAIL approved target not reachable"; fail=1
fi

for target in unapproved=http://unapproved-target.targets.svc.cluster.local:3000/healthz external=https://example.com; do
  name=${target%%=*}
  if probe "$name" "${target#*=}" >/dev/null 2>&1; then
    echo "FAIL $name reachable (should be blocked)"; fail=1
  else
    echo "PASS $name blocked"
  fi
done

exit "$fail"
