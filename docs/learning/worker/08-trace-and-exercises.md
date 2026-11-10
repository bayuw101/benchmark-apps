# 08: Trace dan Latihan Worker

## Istilah yang dipakai di modul ini

- **Trace** — mengikuti satu run ID melintasi boundary dan mencari bukti pada setiap tahap.
- **Boundary** — titik perpindahan antar-sistem, misalnya web ke Redis, worker ke Kubernetes, atau runner ke Prometheus.
- **Evidence** — data yang membuktikan sebuah tahap terjadi: DB row, audit, job, pod, log, metric, callback, atau artifact.
- **Expected state** — state yang seharusnya terjadi menurut flow.
- **Observed state** — state yang benar-benar terlihat saat investigasi.
- **Recovery path** — mekanisme yang memperbaiki pekerjaan setelah event hilang atau process restart, misalnya sweep/reconciliation.

## Trace A: Start normal

Pilih satu smoke run.

```text
Web startRun
→ DB queued
→ BullMQ handler
→ withLock
→ dispatch
→ dispatchPass
→ schedule start=true
→ worker startRun
→ approval + preflight
→ seedTestData
→ executor.create
→ DB starting
→ reconcile
→ markRunning
```

Catat bukti di:

- PostgreSQL `runs`, `audit_logs`.
- RedisInsight `bull:btb-runs:*`.
- Worker logs.
- `kubectl get testruns,pods -A`.
- UI `/runs` dan `/runs/:id`.

## Trace B: Queued karena target penuh

1. Jalankan satu run pada target A.
2. Start run kedua pada target A.
3. Baca `dispatchPass` dan test `schedule`.
4. Periksa `queuedBehind` di DB.
5. Cocokkan dengan queued card UI.
6. Tunggu run pertama selesai; amati run kedua auto-start.

## Trace C: Preflight gagal

Ubah mock target menjadi unhealthy melalui admin config, lalu Start run local yang sesuai.

Amati:

```text
schedule memberi slot
→ startRun
→ probeTarget fail
→ run tidak menjadi workload aktif
→ preflight + audit menjelaskan alasan
→ pass berikutnya dapat mencoba run lain
```

Kembalikan mock config setelah latihan.

## Trace D: Live metrics

```text
sampleLive
→ Prometheus query
→ Redis sample
→ SSE
→ LiveRun
```

Bandingkan satu timestamp di Prometheus, RedisInsight, dan browser Network.

## Trace E: Emergency stop

```text
Web status stopping
→ BullMQ stop
→ worker stopRun
→ executor.delete
→ callback/exit
→ finishRun aborted
→ cleanup + artifacts + audit
→ dispatch queued berikutnya
```

## Trace F: Worker restart

Local kind saja:

1. Start run.
2. Restart worker container.
3. Periksa heartbeat/lease behavior.
4. Setelah hidup, `reconcile` membaca active DB rows dan executor status.
5. Pastikan run tidak diduplikasi.

## Trace G: Telemetry loss

Ikuti evidence/runbook, jangan improvisasi di shared environment. Fokus code:

- `guards.checkTelemetry`.
- `lastPushQuery`.
- `telemetrySilenceSec`.
- `finishRun` outcome/caveat.

## Latihan membaca function

Untuk setiap function, isi template:

```text
Function:
Caller:
Input:
External I/O:
State before:
Decision:
State after:
Return value:
Failure behavior:
Retry/recovery:
UI effect:
```

Function wajib:

1. `dispatch`
2. `dispatchPass`
3. `startRun` worker
4. `schedule`
5. `reconcile`
6. `reconcileRun`
7. `guardRunning`
8. `sampleLive`
9. `finishRun`
10. `summarize`

## Pertanyaan kelulusan

1. Sebutkan dua caller `dispatch`.
2. Mengapa state lock dan live lock berbeda?
3. Mengapa BullMQ job selesai sebelum BTB run selesai?
4. Bagaimana queued run dipulihkan jika enqueue gagal?
5. Bagaimana worker mencegah dua replica mengambil slot sama?
6. Apa beda scheduler decision dan executor action?
7. Bagaimana worker menentukan starting menjadi running?
8. Apa dua sinyal terminal yang digabung?
9. Mengapa telemetry loss abort?
10. Bagaimana verdict, caveat, dan status berbeda?
11. Mengapa cleanup dan audit harus tetap terjadi pada failure?
12. Halaman mana yang membaca setiap output worker?

Jika dapat menjawab dengan menunjuk file dan function, kamu sudah memahami arsitektur worker, bukan hanya menghafal flow.
