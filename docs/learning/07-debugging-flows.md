# Modul 07: Flow Debugging

## Prinsip utama

Jangan langsung mengubah code. Tentukan dahulu di layer mana flow berhenti.

```text
UI → API → PostgreSQL → BullMQ → Worker → Executor → Runner → Target
                                      ↓
                            Prometheus → Redis → SSE
```

Ambil satu run ID dan cari bukti di setiap boundary.

## Run tidak muncul di list

Periksa:

1. Project aktif dan filter URL.
2. Request `GET /api/runs` di Network tab.
3. HTTP status dan response.
4. Row di PostgreSQL.
5. Query/filter di `server/runs.ts`.
6. Pagination overlap atau cache React Query.

Jangan memperbaiki duplicate React key dengan index. Cari duplicate data di boundary penggabungan halaman.

## Run tetap queued

Periksa:

1. Row `runs`: status, `start_requested_at`, `queued_behind`.
2. Audit/timeline: Start berhasil atau tidak.
3. RedisInsight: `bull:btb-runs:*`.
4. Worker heartbeat.
5. Worker log.
6. Active run pada target dan namespace yang sama.
7. Preflight result.
8. Executor capacity.

Kemungkinan umum:

- Slot target/namespace penuh.
- Worker tidak hidup.
- Redis bermasalah tetapi sweep belum berjalan.
- Preflight gagal dan run kembali approved.
- Approval/window tidak lagi valid.

## Run stuck di starting

Periksa:

1. `kubectl get testruns -A`.
2. `kubectl get pods -A`.
3. `kubectl describe` TestRun dan pod.
4. Runner log.
5. Manifest/callback timeline.
6. Secret test data.
7. Platform link dan runner lease endpoint.
8. Starting timeout di reconciliation.

Starting berarti workload dibuat tetapi belum terbukti running.

## Run aborted

Mulai dari structured abort reason:

- `emergency_stop`: user/operator menghentikan.
- `lease_expired`: runner kehilangan control plane.
- `threshold`: k6 abort-on-fail.
- `target_health`: health probe gagal.
- `telemetry_lost`: metrics runner menghilang.
- `policy_breach`: self-check atau safety rule gagal.
- `kubernetes_failure`: workload gagal.

Cocokkan reason dengan audit, callback, runner log, dan executor event.

## Live chart tidak bergerak

Periksa berurutan:

1. Apakah run benar-benar running?
2. Apakah k6 remote-write berhasil?
3. Apakah Prometheus memiliki series run ID?
4. Apakah worker `sampleLive` berjalan?
5. Apakah Redis mempunyai `btb:run:<id>:samples`?
6. Apakah SSE route mengirim event?
7. Apakah browser menerima event?

Jangan mulai dari React chart jika Prometheus belum memiliki data.

## Verdict terlihat salah

Pisahkan input verdict:

1. Threshold result.
2. Summary metrics.
3. Integrity counts.
4. Generator evidence.
5. Caveats.
6. Terminal execution outcome.

Bandingkan:

- Stored `run_summaries`.
- Prometheus query.
- k6 end summary artifact.
- Integrity endpoint response.
- `finish.ts` dan verdict helper.

## Artifact tidak dapat dibuka

Periksa:

1. Metadata `run_artifacts`.
2. Object di MinIO.
3. User access ke project/run.
4. Artifact route response.
5. Content type dan object key.
6. Retention lifecycle.

## Tool map

| Pertanyaan | Tool |
| --- | --- |
| Business state apa sekarang? | PostgreSQL/Drizzle Studio |
| Job queue ada? | RedisInsight |
| Worker hidup? | Redis heartbeat dan worker log |
| Workload dibuat? | `kubectl get/describe` |
| Runner menolak apa? | Pod log dan callback audit |
| Metrics masuk? | Prometheus |
| Deep metric analysis? | Grafana |
| File benar-benar ada? | MinIO console |
| Request UI gagal di mana? | Browser Network/Console |

## Format catatan diagnosis

```text
Run ID:
Expected:
Observed:
Last confirmed boundary:
First missing/incorrect boundary:
Evidence:
Hypotheses:
Smallest reproduction:
Fix:
Regression check:
```

## Checkpoint akhir

Pilih satu seeded failed atau aborted run dan jawab:

1. Trigger awalnya apa?
2. Boundary terakhir yang berhasil apa?
3. Siapa yang menetapkan terminal status?
4. Bukti mana yang membuat reason dapat dipercaya?
5. Apakah failure dapat pulih otomatis atau memerlukan manusia?

Setelah menyelesaikan modul ini, gunakan [runbook](../operations/runbook.md) untuk prosedur operasional dan [codebase guide](../architecture/codebase-guide.md) sebagai reference.
