# 07: Katalog File dan Function Worker

## Istilah yang dipakai di modul ini

- **Caller** — function/module yang memanggil symbol tertentu.
- **Callee** — function/module yang dipanggil oleh symbol tersebut.
- **Dependency graph** — peta arah hubungan antar-module; bukan urutan waktu execution.
- **Orchestrator** — function yang mengatur urutan beberapa operasi, misalnya `finishRun`, tanpa mengimplementasikan semua detail sendiri.
- **Adapter** — module yang menerjemahkan interface umum ke PostgreSQL, Kubernetes, Docker, Prometheus, atau S3.
- **UI effect** — perubahan state/evidence worker yang kemudian dibaca web; worker tidak merender UI langsung.

## Peta dependency

```text
main
├── env, context, log, lock
├── dispatch
│   ├── plan, hooks, kube, finish
│   └── executor melalui context
├── reconcile
│   ├── plan, executor, finish
│   └── audit/database
├── guards
│   ├── plan telemetry query
│   └── dispatch.probeTarget
└── live
    ├── plan.liveQueries
    ├── prometheus
    └── Redis

finish
├── summary → prometheus + plan queries
├── integrity → kube/fetch + core adapter
├── hooks
└── artifacts → executor logs + MinIO
```

## Katalog

### `main.ts`

| Symbol | Dipanggil oleh | Memanggil | Kapan |
| --- | --- | --- | --- |
| BullMQ handler | BullMQ | `withLock`, `stopRun`, `dispatch` | Job dispatch/stop |
| `tick` | timer + startup | heartbeat, `reconcile`, `guardRunning`, `dispatch` | Setiap 5 detik |
| `liveTick` | timer + startup | `tryWithLock`, `sampleLive` | Setiap 5 detik |
| `shutdown` | SIGTERM/SIGINT | close worker, lock barriers, close clients | Deploy/stop process |

### `env.ts`

| Symbol | Fungsi |
| --- | --- |
| `fromEnv` | Env dengan safe dev default |
| `intFromEnv` | Parse integer config |
| `dockerEnvironments` | Parse Docker placement list |
| `loadConfig` | Build seluruh WorkerConfig |

### `context.ts`

| Symbol | Fungsi |
| --- | --- |
| `Ctx` | Dependency contract antar-worker modules |
| `placement` | Pilih executor dan scope per environment |

### `lock.ts`

| Symbol | Fungsi |
| --- | --- |
| `LOCK_KEY` | Serialize state mutation |
| `LIVE_LOCK_KEY` | Single live sampler |
| `withLock` | Blocking session advisory lock |
| `tryWithLock` | Non-blocking advisory lock |

### `dispatch.ts`

| Symbol | Fungsi | UI effect |
| --- | --- | --- |
| `dispatch` | Multi-pass queue scheduling | Queued run maju |
| `dispatchPass` | Snapshot, schedule, apply decisions | `queuedBehind` |
| `startRun` | Preflight, claim, executor create | Starting/preflight/timeline |
| `approvalCheck` | Validasi approval current hash | Start allowed/blocked |
| `workerPreflight` | Semua execution-time checks | Checklist detail |
| `probeTarget` | Health check direct/service proxy | Target health reason |

### `plan.ts`

| Kelompok | Symbols utama |
| --- | --- |
| Scheduler | `schedule` |
| Resource | `parallelismFor`, `runnerResources`, `goMemLimit`, `capacityNeed`, `capacityShortfall` |
| Runner config | `runnerConfig`, `tokenExpiry`, `runnerImage` |
| Kubernetes | `testRunManifest`, `clusterService`, `kubeStatus` |
| Outcome | `outcomeOf`, `withCallbacks`, `runnerDied`, `selfCheckRefusal` |
| Result | `verdictOf`, `caveatsOf`, `saturationOf` |
| PromQL | `liveQueries`, `summaryQueries`, `journeyQueries`, `browserQueries`, `saturationQueries` |
| Docker | `dockerRunArgs`, `dockerStatus`, `dockerHostname` |

Semua dipakai worker modules; tidak dipanggil UI secara langsung.

### `executors.ts`

| Class | Fungsi |
| --- | --- |
| `KubernetesExecutor` | Implement generic lifecycle melalui TestRun/pod |
| `DockerExecutor` | Implement lifecycle melalui Docker CLI untuk local-only |

### `kube.ts`

| Symbol | Fungsi |
| --- | --- |
| `withTimeout` | Batasi Kubernetes API call |
| `kubeErrorMessage` | Normalize API error |
| `Kube` | CRUD TestRun, pod status/log, quota, service proxy |
| `info` | Parse raw TestRun |

### `reconcile.ts`

| Symbol | Fungsi | Dipakai saat |
| --- | --- | --- |
| `reconcile` | Loop active + orphan sweep | Periodic tick |
| `reconcileRun` | State comparison per run | Starting/running/stopping |
| `runnerCallbacks` | Read callback audit | Terminal evaluation |
| `refusedInLog` | Callback fallback | Runner self-check failure |
| `markRunning` | starting → running | Executor active |
| `stopRun` | Delete + abort finalization | Stop job/tick |
| `sweepOrphans` | Delete unowned workloads | Recovery |

### `guards.ts`

| Symbol | Fungsi |
| --- | --- |
| `guardRunning` | Orchestrate telemetry/health guard |
| `checkTelemetry` | Abort ketika metrics hilang |
| `checkHealth` | Abort setelah target health failures |

### `live.ts`

| Symbol | Fungsi |
| --- | --- |
| `sampleLive` | Prometheus → LiveSample → Redis |

### `prometheus.ts`

| Symbol | Fungsi |
| --- | --- |
| `Prometheus.ready` | Monitoring preflight |
| query methods | Prometheus HTTP API dan parsing |

### `summary.ts`

| Symbol | Fungsi |
| --- | --- |
| `summarize` | Build durable summary |
| `saturation` | Generator evidence |
| `journey` | Step/funnel metrics |
| `vitals` | Browser web vitals |

### `finish.ts`

| Symbol | Fungsi |
| --- | --- |
| `finishRun` | Terminal orchestration |
| `checkIntegrity` | Adapter + timeline result |
| `endEntry` | Terminal audit message |

### `hooks.ts`

| Symbol | Fungsi |
| --- | --- |
| `runHook` | Safe target-owned HTTP hook |
| `poolOf` | Load pool config |
| `seedTestData` | Pre-run setup |
| `cleanupTestData` | Always-run cleanup |

### `integrity.ts`

| Symbol | Fungsi |
| --- | --- |
| `httpIntegrityAdapter` | Read-only target reconciliation |
| `withTimeout` | Adapter timeout |

### `artifacts.ts`

| Symbol | Fungsi |
| --- | --- |
| `ArtifactStore` | S3/MinIO wrapper |
| `collectArtifacts` | Runner logs/summary/artifact metadata |

### `log.ts`

| Symbol | Fungsi |
| --- | --- |
| `log` | Structured operational log |
| `errorMessage` | Normalize unknown errors |

### `plan.test.ts`

Unit tests untuk scheduler, resource math, runner config, outcomes, verdict/caveat, PromQL, Kubernetes/Docker mapping. Mulai deep dive function `plan.ts` dari test terkait, bukan dari seluruh file.
