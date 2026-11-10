# Benchmark tool (BTB)

Performance audit platform for the ticketing system: engineers plan load tests, approvers sign off, runners
(k6 on Kubernetes) send the load, and everyone watches live metrics, verdicts and reports.

| Path | What |
| --- | --- |
| `apps/web` | Web app and API (Next.js 15). UI conventions: [`apps/web/README.md`](apps/web/README.md) |
| `apps/worker` | Runs the runs: dispatch, k6 TestRuns, guards, live samples, results |
| `packages/contracts` | Types, constants and zod schemas shared by everything |
| `packages/core` | Database schema and migrations (Drizzle), policy, manifest, seed scripts |
| `packages/k6-lib`, `journeys` | Runner library and the k6 journeys; `journeys` builds the runner image |
| `infra/local` | Docker Compose stack for development |
| `infra/kind` | Local Kubernetes cluster (kind) with k6 Operator and the runner guardrails |
| `infra/grafana` | Grafana dashboards (optional locally) |
| `docs` | [Documentation index](docs/README.md): product, architecture, learning guides, and operations |

## Quick start

Needs Node 22+, pnpm (`corepack enable`), and Docker. The full stack also needs
[`kind`](https://kind.sigs.k8s.io) and [`kubectl`](https://kubernetes.io/docs/tasks/tools/), a few GB of free
RAM, and internet access the first time (images, Calico, k6 Operator).

```sh
pnpm dev:up
```

That one command starts everything and ends with the web app on http://localhost:3001 (first run: a few
minutes):

1. `pnpm install`, and `apps/web/.env.local` from `.env.example` if it is missing
2. Docker Compose: Postgres, Redis, Prometheus, MinIO, mock target
3. kind cluster `btb`: k6 Operator, Calico, runner guardrails, and the runner image
4. database migrations and dev data (below)
5. the worker (a Compose container)
6. the web app, in the foreground

Open http://localhost:3001 and sign in with one of the dev accounts on the login page (sign-in is a mock until
Entra ID is set up). Ctrl+C stops the web app only; everything else keeps running, so the next `pnpm dev:up` is
quick, or just `pnpm dev` for the web app alone. `dev:up` is safe to run again at any time: after a pull, or
whenever something is down. If the web app is already running, it leaves it alone.

```sh
pnpm dev:up:ui         # UI work only: no kind, no worker (lighter; runs can be approved but never start)
pnpm dev:up --no-web   # set everything up, don't start the web app
pnpm dev               # the web app alone, once the rest is up
pnpm dev:status        # what is running
pnpm dev:down          # stop the Compose stack, keep its data (--wipe: delete data too, --all: delete the kind cluster too)
```

Docker itself must already be running; the script doesn't start the Docker daemon. Grafana is optional (see
below). Options pass straight through, e.g. `pnpm dev:down --wipe`. The script is `scripts/dev.sh`.

### Dev data

`pnpm db:seed` and `pnpm db:seed:runs` (both run by `dev:up`) add, without touching existing rows:

- **Accounts** (pick one on the login page): admin, engineer, two approvers (prod-like runs need two), viewer, and
  one with no role. A "sign-in failure" entry simulates Microsoft sign-in failing. List: `packages/core/src/dev-accounts.ts`.
- **Project** Ticketing with targets `mock-target` (staging) and `mock-target-prod` (prod-like). Both point at the
  mock ticketing service in the kind cluster.
- **Test-data pool** of 50 fake identities for `mock-target`.
- **Scenarios** Checkout, Browse event, Receive ticket and Scan ticket (v1 each), on the runner image just built.
- **15 example runs** over the last 30 days (`packages/core/src/scripts/seed-runs.ts`), so the run list, results,
  reports and approvals have something to show without the kind cluster:
  - a Checkout baseline per release on prod-like (2026.10.1 to 2026.11.1) for the release trend, with 2026.10.4
    pinned as the baseline, so the latest run shows a regression;
  - results of every kind: pass, fail on broken integrity, threshold abort, emergency stop, target unhealthy, a
    failed run (runner pod gone), and a pass with a measurement-gap caveat;
  - runs waiting on people: pending approval (1 of 2), approved (ready to start), rejected with a note.

  The numbers are made up and the runs have no artifacts (the downloads list is empty). `db:seed:runs` only
  adds them while the project has no runs. For a real run, start a smoke run on `mock-target` as the engineer
  (2 minutes, needs the full stack).

### Local services

All bound to `127.0.0.1`. Ports can be changed in `infra/local/.env` (copy `infra/local/.env.example`).

| Service | Address | Notes |
| --- | --- | --- |
| Web app | http://localhost:3001 | Started by `pnpm dev:up`, or `pnpm dev` alone. Fixed port: runner pods in kind reach it there for their lease |
| Postgres | `127.0.0.1:15432` | db `btb`, user `btb`, dev-only password in `infra/local/.env.example` |
| Redis | `127.0.0.1:16379` | RedisInsight UI on http://localhost:5540 |
| Prometheus | `kubectl -n monitoring port-forward svc/prometheus 9091:9090`, then http://localhost:9091 | The single local metrics store runs in kind |
| MinIO | http://localhost:19001 | Console; bucket `btb-artifacts` |
| Mock target | http://localhost:8081 | The same mock ticketing service as in kind, for poking at it |
| Grafana | http://localhost:3300 | Optional: `docker compose -f infra/local/docker-compose.yml --profile grafana up -d grafana` |

### Settings

Everything has a dev default, so no `.env` is needed to start. `dev:up` copies `apps/web/.env.example` to
`apps/web/.env.local` (git-ignored); the example lists the optional settings (`GRAFANA_URL`, `AUTH_MODE`, first
admin). Worker settings: `apps/worker/src/env.ts`. The dev defaults are refused in a production build. Never
commit `.env.local` or real credentials.

### Everyday commands

```sh
pnpm check                         # typecheck + lint + unit tests in every package (CI runs the same)
pnpm --filter @btb/web test        # one package
pnpm db:generate --name <x>        # after editing packages/core/src/db/schema.ts; review the SQL, then pnpm db:migrate
pnpm --filter @btb/core db:studio  # browse the database
```

After changing...

| What | Do |
| --- | --- |
| `apps/web` | Nothing: `pnpm dev` reloads |
| `apps/worker` | `docker compose -f infra/local/docker-compose.yml --profile worker up -d --build worker`, or run it on the host (below) |
| `journeys` or `packages/k6-lib` | `(cd journeys && pnpm run image) && pnpm catalog:sync`, then save a new scenario version so runs use the new image |
| `infra/kind/manifests` | `infra/kind/up.sh` |

### Troubleshooting

- **A run stays `queued`**: the worker isn't running (`pnpm dev:status`), or another run holds the target.
  Logs: `docker compose -p btb-dev logs -f worker`.
- **Runs abort with `lease_expired` right after starting**: runner pods can't reach the web app. Is the web app
  up on port 3001 (`pnpm dev:status`)? `infra/kind/platform-link.sh` re-points the cluster at it.
- **Port 3001 is taken**: stop whatever holds it. The port is fixed in `apps/web/package.json` and
  `infra/kind/platform-link.sh` (`WEB_PORT`).
- **The worker can't reach Kubernetes after a reboot or a recreated cluster**: `infra/kind/worker-kubeconfig.sh`,
  then restart the worker.
- **Start from scratch**: `pnpm dev:down --wipe --all`, then `pnpm dev:up`.

## Reference

### Infrastructure (`infra/`)

Dev only. Every port binds to `127.0.0.1`; override in `infra/local/.env` (copy from `.env.example`).

**Compose stack** (BTB-20): Postgres `:15432`, Redis `:16379`, Prometheus `:9090` (remote-write receiver + native histograms), MinIO `:19000` / console `:19001` (bucket `btb-artifacts`), mock target `:8081`.

```sh
docker compose -f infra/local/docker-compose.yml up -d --build
docker compose -f infra/local/docker-compose.yml run --rm k6     # smoke run -> Prometheus, testid=local-smoke
docker compose -f infra/local/docker-compose.yml down            # add -v to wipe data
```

Mock target (`infra/mock-target`): `GET /healthz`, `GET /events[/:id]`, `GET /events/:id/page` (HTML event page for browser steps), `POST /orders {eventId, qty}`. Faults via env (`MOCK_LATENCY_MS`, `MOCK_ERROR_RATE`, `MOCK_OVERSELL`) or at runtime: `POST /__admin/config {"latencyMs","errorRate","oversell","healthy"}`, `GET /__admin/integrity[?since=&until=]` (epoch ms; charge counts limited to that window), `POST /__admin/reset`.

**kind cluster** (BTB-22): needs `kind` and `kubectl`. Uses Calico as CNI (kindnet's NetworkPolicy engine fails open on some host kernels), installs k6 Operator v1.7.0, namespaces `perf-staging` and `perf-prod` (runners, quota + default-deny egress, one per environment), `targets`, `monitoring` (Prometheus receiving k6 remote-write, NodePort 30090) and `btb-system` (the `btb-worker` ServiceAccount; `up.sh` writes its kubeconfigs to `infra/kind/.kube/`).

```sh
infra/kind/up.sh
infra/kind/netpol-check.sh                  # approved target reachable, unapproved + internet blocked
kubectl apply -f infra/kind/testrun.yaml    # sample TestRun against the mock target
kubectl -n perf-staging logs -l k6_cr=smoke,runner=true
kubectl -n monitoring port-forward svc/prometheus 9091:9090   # then query k6_http_reqs_total{testid="kind-smoke"} at http://localhost:9091
infra/kind/down.sh
```

### Execution path (`apps/worker`)

Web `Start` -> run `queued` + BullMQ job (`btb-runs`) -> worker: capacity (1 active run per target, 2 per namespace), worker preflight (target health via the API server's service proxy, Prometheus ready, quota headroom), `starting` + k6 `TestRun` in the environment's namespace -> `running` when the operator starts it -> live samples every 5 s (Prometheus -> Redis `btb:run:<id>:samples` -> SSE) -> on finish: runner exit codes (99 = threshold abort), summary from Prometheus into `run_summaries`, verdict + caveats, timeline rows, TestRun deleted, next queued run dispatched. Emergency stop deletes the TestRun. All state changes run under one Postgres advisory lock.

```sh
# In Compose (needs the kind cluster: joins the `kind` docker network, mounts infra/kind/.kube/worker.yaml)
docker compose -f infra/local/docker-compose.yml --profile worker up -d --build worker
docker compose -p btb-dev logs -f worker

# Or on the host (kubeconfig defaults to infra/kind/.kube/worker-host.yaml)
PROMETHEUS_URL=http://$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' btb-control-plane):30090 pnpm dev:worker
```

Run only one of the two at a time while debugging (both are safe together, but the logs split). Settings: `apps/worker/src/env.ts`.

Also in the path:

- **Guards** (every tick while running): target health (3 failed probes abort, `target_health`) and telemetry (no samples for too long abort, `telemetry_lost`).
- **Runner lease** (E6.1): each runner pod checks in at `POST /api/runner/lease` on the web app every 10 s with an HMAC token (`LEASE_SECRET`, same value in web and worker; dev default built in). The token is `<expiry>.<HMAC(run id, expiry)>` and expires at planned length + 30 min, counted from when the worker creates the TestRun. It aborts itself (exit 108, `lease_expired`) after 60 s without a `continue`, e.g. when no worker heartbeat is in Redis. In kind, `infra/kind/platform-link.sh` points Service `btb-system/btb-platform` at the web dev server on the host (`WEB_PORT`, default 3001) and opens egress to it.
- **Runner self-check** (E5.3): k6 `setup()` runs in every runner pod (k6-operator doesn't pass `--no-setup`) and fetches `GET /api/runner/manifest`. It recomputes the SHA-256 of the stored manifest, then checks it against the approved hash and its own config, checks the approvals, and checks that its allowlist is within the target's. On any mismatch it aborts before any load and the run ends `aborted` / `policy_breach`.
- **Runner protocol**: the image build writes `image.protocol` (`RUNNER_PROTOCOL`, now 2 = self-check + callbacks) into `catalog.json`, and `catalog:sync` stores it on `runner_images` (images from before are 1). Policy refuses scenario versions on an older image (`outdated_runner`), and the worker refuses them again at preflight. Saving a new version moves a scenario to the current image.
- **Signed callbacks** (E5.4/E6.6): pods report `verified`, `refused`, `stopped` (lease abort) and `finished` (thresholds, iterations) to `POST /api/runner/callback`. Each callback carries the Bearer token plus `x-btb-signature` (HMAC of the raw body keyed with the token), with a cap of 4 KiB per body and 200 per run. They land on the run timeline. At the end, the worker combines them with the pod exit codes: a refusal becomes `policy_breach`, and a pod without a result callback gets a "Result callback missing" entry. If a refusal's callback is lost (platform unreachable in `setup()`), the worker reads it from the k6 summary in the pod log: no `setup_data.verified` means no scenario ran. Platform calls are tagged `btb-*` and kept out of the load numbers.
- **Test data** (E2.6): a target's pool can have HTTP seed/cleanup hooks (Admin -> Test data). Seed runs as the last worker preflight check; cleanup after every run. The identities themselves never pass through the platform: the pool stores only an External Secrets path, an ExternalSecret fills Secret `btb-test-data-<target>` (key `identities.json`, a JSON array) in each runner namespace, and the TestRun mounts it read-only at `/var/run/btb/test-data`. The runner config carries just the Secret's name and the pool size; each runner takes its execution segment's share (`ctx.identities()`), and refuses to start (no load) when the Secret is missing or unreadable. kind gets fake ones from `infra/kind/manifests/25-test-data.yaml`.
- **Executors** (E5.1/E5.5): the worker drives runners through `Executor` (`packages/core/src/executor.ts`): `KubernetesExecutor` (TestRun) everywhere, `DockerExecutor` for local development only. `WORKER_DOCKER_ENVIRONMENTS=staging` sends that environment's runs to one `docker run` runner container on the worker's machine (host network; the worker must run on the host, not in Compose). It is refused when `NODE_ENV=production`, and preflight refuses any target whose hosts aren't loopback (`localhost`, `127.x`, `::1`) or that has a test-data pool. Optional: `DOCKER_RUNNER_NETWORK`, `DOCKER_RUNNER_LEASE_URL` (default `http://127.0.0.1:3001/api/runner/lease`), `DOCKER_RUNNER_PROMETHEUS_RW_URL` (default: the worker's `PROMETHEUS_URL` + `/api/v1/write`).
- **Artifacts**: on finish the worker stores each runner's k6 summary and log tail in MinIO/S3 (`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) and lists them in `run_artifacts`; the run page downloads them through short-lived presigned URLs. Kept 90 days: `minio-init` sets a bucket lifecycle rule (`ARTIFACT_RETENTION_DAYS`).
- **Browser steps** (E7.3/E7.8): the runner image is `grafana/k6:<ver>-with-browser`. A run with a network profile gets a `btb-browser` scenario (1 Chromium VU per runner pod, bigger runner resources) next to the protocol load; Stadium 4G throttles network and CPU (values in `packages/k6-lib/src/options.ts`, PROPOSAL), Wi-Fi baseline doesn't. The worker stores p75 LCP/INP/CLS/FCP/TTFB per step in `run_summaries.browser`; browser VUs and requests stay out of the load numbers.
- **Browser evidence** (E5.7): while the run is live, each browser VU uploads to `POST /api/runner/artifacts` (lease token auth, fixed file names, 1 MiB per file, 60 per run): a PNG of each step's first success and first 3 failures, and `browser-errors-vu<n>.json` (console errors, uncaught page errors, failed steps, deduplicated with counts). They show up with the other run artifacts.
