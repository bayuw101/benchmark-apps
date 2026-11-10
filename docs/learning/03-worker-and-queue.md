# Modul 03: Worker dan Queue

## Tujuan

Memahami mengapa BullMQ dipakai, bagaimana worker memilih run, dan bagaimana sistem pulih dari restart atau pesan yang hilang.

## BullMQ bukan lifecycle run

Web menambahkan job ke queue `btb-runs`. Job ini hanya meminta worker memeriksa pekerjaan.

```text
PostgreSQL row queued = pekerjaan resmi
BullMQ dispatch job   = bel untuk membangunkan worker
```

Job dapat selesai ketika run masih `starting` atau `running`. Jangan menyamakan status job BullMQ dengan status run.

Baca:

- `apps/web/src/lib/server/redis.ts`
- `apps/worker/src/main.ts`
- `packages/contracts/src/index.ts` — `RUNS_QUEUE`, `RunJob`

## Main loop worker

`apps/worker/src/main.ts` membuat:

- Koneksi PostgreSQL.
- Koneksi Redis.
- BullMQ Worker.
- Executor.
- Prometheus client.
- Artifact store.
- Periodic tick.
- Live tick.
- Graceful shutdown.

Flow sederhananya:

```text
BullMQ dispatch job ─┐
Periodic sweep ──────┼→ withLock → reconcile → dispatch
Stop job ────────────┘

Live interval → sampleLive + health/telemetry guard
```

Periodic sweep adalah recovery path jika enqueue gagal atau worker restart.

## Advisory lock

Beberapa BullMQ job, timer, atau replica worker dapat berjalan bersamaan. Keputusan scheduling harus satu per satu.

`apps/worker/src/lock.ts` memakai PostgreSQL advisory lock. Redis lock tidak dipakai karena keputusan dan state utamanya berada di PostgreSQL.

## Scheduler

`apps/worker/src/plan.ts` berisi fungsi scheduling yang relatif pure dan mudah diuji.

Aturan utama:

- Maksimal satu active run per target.
- Maksimal dua active run per namespace.
- Run lain tetap queued dan mencatat blocker.

`apps/worker/src/plan.test.ts` adalah tempat terbaik memahami contoh keputusan scheduler.

## Worker preflight

`apps/worker/src/dispatch.ts` memeriksa kondisi sedekat mungkin dengan eksekusi:

- Manifest hash masih cocok.
- Approval masih valid.
- Runner protocol masih didukung.
- Execution window masih valid.
- Target sehat.
- Monitoring tersedia.
- Runner capacity tersedia.
- Test-data pool dan Secret siap.

Jika gagal karena kondisi yang dapat diperbaiki, run kembali ke `approved` dengan alasan jelas. Jika terjadi policy breach serius, hasilnya dapat menjadi rejected atau aborted sesuai tahap.

## Executor

Contract ada di `packages/core/src/executor.ts`.

Implementasi ada di `apps/worker/src/executors.ts`:

- `KubernetesExecutor`: normal execution melalui k6 Operator.
- `DockerExecutor`: development-only, hanya loopback target, ditolak di production.

Worker memakai interface yang sama untuk create, status, delete, log, runner info, dan orphan detection.

## Reconciliation

`apps/worker/src/reconcile.ts` membandingkan PostgreSQL dengan executor:

```text
DB starting + workload running  → DB running
DB running + workload finished  → finishRun
DB stopping + workload exists   → delete workload
DB active + workload hilang     → fail/abort dengan alasan
workload milik BTB tanpa row     → orphan cleanup
```

Karena reconciliation, worker tidak bergantung pada satu callback atau event.

## Observasi dengan RedisInsight

Cari:

```text
bull:btb-runs:*
btb:worker:heartbeat
btb:run:<id>:samples
```

Perhatikan job berpindah dari wait ke active/completed. Lalu bandingkan dengan status run yang masih berjalan.

## Latihan failure

Di local kind:

1. Mulai satu smoke run.
2. Matikan worker ketika run aktif.
3. Amati lease dan workload.
4. Hidupkan worker kembali.
5. Amati reconciliation menemukan run.

Ikuti runbook; jangan lakukan eksperimen ini di shared environment.

## Checkpoint

1. Mengapa BullMQ hanya dianggap wake-up signal?
2. Mengapa worker tetap memiliki periodic sweep?
3. Mengapa scheduling membutuhkan lock?
4. Apa beda preflight web dan preflight worker?
5. Bagaimana worker mengetahui run sudah selesai setelah restart?
6. Mengapa DockerExecutor dibatasi ke loopback?
