# BTB Delivery Status

This document summarizes implementation status against the [PRD](prd.md) and [feature breakdown](feature-breakdown.md). Detailed measurements live under [`docs/evidence`](../evidence/); operating instructions live in the [runbook](../operations/runbook.md).

Last updated: 9 November 2026.

## Status summary

| Area | Status | Notes |
| --- | --- | --- |
| Core application, policy, approvals, and audit | Complete locally | Shared schemas, manifest-bound approvals, transactional audit |
| Runner verification and fail-safe protocol | Complete locally | Short-lived HMAC token, manifest self-check, signed callbacks, lease |
| k6 journeys and mock ticketing target | Complete locally | Browse, checkout, receive, scan; ticketing UI and fault controls |
| Integrity, summaries, trends, reports, artifacts | Complete locally | Target adapter, release trend, MinIO artifacts, HTML report |
| Worker executors and recovery | Complete locally | Kubernetes executor, local-only Docker executor, reconciliation |
| Spike validation and safety evidence | Complete in kind | Evidence under `docs/evidence/m5/`; current recommendation is Go |
| Operational assets | Mostly complete | Runbook and Grafana dashboards exist; emergency contacts remain TBD |
| Bitbucket delivery pipeline | Draft | Registry push, catalog sync, and GitOps update wait on external decisions |
| Enterprise platform integration | Not complete | Entra ID, EKS, External Secrets, S3, CloudWatch, and staging DB access |
| Prod-like pilot | Not complete | Requires external environment and named approvers |

## Completed milestones

### Runner integrity and callbacks

- Runner fetches the current manifest, recomputes its hash, verifies approval and protocol, and obtains a lease before VUs start.
- Runner callbacks are HMAC-signed and bounded by body size and per-run count.
- A missing or invalid self-check fails closed before target traffic.
- Legacy runner images are rejected through `RUNNER_PROTOCOL`.

Evidence includes normal, tampered-manifest, revoked-approval, invalid-signature, multi-pod, and unreachable-platform runs.

### Complete ticketing journeys

- The mock target implements cart hold, checkout, idempotent sandbox payment, confirmation, delayed ticket issuance, and scanning.
- Checkout records per-step latency, funnel completion, payment-to-confirmation latency, and journey integrity counters.
- Browser, receive-poll, and scan journeys are versioned in the runner catalog.
- Journey lint and tests run through `pnpm check`.

### Integrity and release trends

- Targets may configure a read-only integrity endpoint.
- Finalization checks oversold seats, double charges, and charged-without-ticket orders for the run window.
- Non-zero integrity counts fail the verdict; unavailable verification adds `integrity_not_verified`.
- Results and reports show journey detail, integrity, baseline comparison, and release trends.

### Web and executor hardening

- Every API route is wrapped by `withAuth` or `withRunnerAuth`; tests scan route files for violations.
- Shared Zod schemas validate API and form boundaries.
- `Executor` separates lifecycle logic from Kubernetes details.
- `KubernetesExecutor` is the normal executor. `DockerExecutor` is development-only and restricted to loopback targets.
- Test identities are mounted from Kubernetes Secrets and partitioned per runner segment; values never enter manifests or artifacts.
- MinIO applies artifact retention through compose initialization.

### Validation and operational evidence

Completed local-kind validation covers:

- Native-histogram percentile accuracy.
- Browser VU capacity.
- Generator calibration and `GOMEMLIMIT` behavior.
- Long-running SSE stability.
- Dashboard down, web down, worker down, runner pod loss, and telemetry loss.
- NetworkPolicy and ResourceQuota enforcement.
- Grafana versus stored-summary comparison.

See [go/no-go.md](../evidence/go-no-go.md) and `docs/evidence/m5/` for commands, run IDs, measurements, and conclusions.

### Operational readiness assets

- `scripts/dev.sh` provides idempotent local startup, status, and shutdown.
- The [runbook](../operations/runbook.md) documents normal and emergency procedures.
- Grafana provisioning includes k6 run and runner-pod dashboards.
- Web, worker, and runner versions are recorded per run and included in reports.
- The repository includes a draft Bitbucket pipeline and deployable web/worker/runner images.

## Current decisions

| Decision | Current choice |
| --- | --- |
| Runner wrapper | k6-lib setup/teardown protocol; no separate `apps/agent` for MVP |
| Runner token lifetime | Run duration plus 30 minutes, starting when the worker creates execution |
| Local integrity adapter | Read-only target endpoint with run-window query parameters |
| Measurement tolerance | Within 5% or 1 ms, whichever is greater |
| Local execution | kind and Docker executor; no direct non-Docker k6 mode |
| Shared config package | Not added; existing TypeScript and lint configurations do not justify it yet |
| Automatic measurement-gap caveat | Not added after the final-push timing fix removed the observed mismatch |

## Remaining repository work

### Bitbucket pipeline completion

The checked-in pipeline is a draft until the team provides:

- Container registry and credentials.
- Final branch/deployment policy.
- Catalog-sync destination and credentials.
- GitOps repository and update convention.

After these are known, enable image push, catalog synchronization, and GitOps updates from the same commit.

### Runbook ownership

Replace TBD emergency contacts with named operational owners and escalation channels before a shared staging rollout.

### Documentation maintenance

- Keep this status document concise.
- Record raw measurements under `docs/evidence/`.
- Update the runbook when procedures change.
- Update the PRD only when requirements change, not when implementation status changes.

## External work

| Work | Dependency |
| --- | --- |
| Microsoft Entra ID through Auth.js | Entra app registration and tenant configuration |
| EKS namespaces, k6 Operator, node pool, quotas, and NetworkPolicy through GitOps | DevOps platform ownership |
| Prometheus retention and Grafana SSO | DevOps monitoring platform |
| External Secrets, S3 lifecycle, Fluent Bit, and CloudWatch links | Cloud infrastructure and IAM |
| Payment sandbox limit validation | Ticketing team |
| Real staging integrity adapter | Read-only ticketing data access |
| Real target reference peaks and ceilings | Engineering manager and DevOps |
| Low-volume prod-like pilot with two approvers | Prod-like environment and named approvers |

## Exit criteria

BTB is ready for a shared staging rollout when:

1. The draft CI/CD path is connected to the approved registry and GitOps flow.
2. Entra ID and the first production admin are configured.
3. Required Kubernetes, monitoring, secret, object-storage, and logging infrastructure exists.
4. Real targets, ceilings, test identities, and integrity access are configured.
5. Emergency contacts and ownership are named.
6. The safety matrix is repeated in the staging platform and attached as evidence.

The prod-like pilot remains a separate release gate after staging readiness.
