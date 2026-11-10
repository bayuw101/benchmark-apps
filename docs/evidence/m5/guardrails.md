# M5.7: NetworkPolicy and ResourceQuota hold regardless of app policy (PRD E11.3, E6.7)

Date: 2026-11-08, kind cluster `btb` (Calico).

## NetworkPolicy (`netpol-check.txt`)

`infra/kind/netpol-check.sh` in both runner namespaces: approved target reachable (HTTP 200), `unapproved-target`
(same image, no approval label) blocked, internet (`https://example.com`) blocked. PASS in `perf-staging` and
`perf-prod`.

The script counts any failed probe as "blocked", so the blocks were checked separately: from `perf-staging`, curl to
`unapproved-target` and to the internet ends with exit 28 (timeout, packets dropped); the control, the same request
from namespace `targets` (no runner policy), gets 200. The block is the policy, not a broken probe.

Finding: Calico applies a policy change to new connections only. Removing the Prometheus egress rule while a runner
was pushing did not stop its pushes (its keep-alive connection stayed open; RUN-0186). A guardrail tightened mid-run
does not cut existing connections. The allowlist is fixed for a run's lifetime, so this matters only for operators
expecting a policy edit to act as a kill switch; the emergency stop is the kill switch.

## ResourceQuota (`resourcequota.txt`)

`perf-quota` (pods 10, requests.cpu 2, requests.memory 2Gi, limits.cpu 4, limits.memory 4Gi) in both namespaces.
A pod requesting 3 CPU, created with `kubectl apply --dry-run=server`: **Forbidden: exceeded quota: perf-quota,
requested: requests.cpu=3, limited: requests.cpu=2** in both namespaces. Admission enforces it whatever the app's
policy says. The worker also refuses a run before creating the TestRun when the quota has no room (preflight
`runner_capacity`, `capacityShortfall`, unit-tested).
