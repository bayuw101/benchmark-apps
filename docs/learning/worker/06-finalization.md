# 06: Finalization, Summary, Integrity, Hooks, dan Artifacts

## Istilah yang dipakai di modul ini

- **Finalization** — rangkaian pekerjaan ketika run berakhir: summary, integrity, verdict, cleanup, artifacts, audit, dan terminal state.
- **Summary** — ringkasan durable metrics penting yang disimpan di PostgreSQL setelah raw metrics expired.
- **Integrity** — pemeriksaan correctness business target: oversold, double charge, dan charged-without-ticket harus nol.
- **Verdict** — pass/fail hasil performance dan integrity.
- **Caveat** — peringatan bahwa hasil memiliki keterbatasan, misalnya generator saturated atau integrity tidak terverifikasi.
- **Saturation** — kondisi generator k6 kehabisan CPU/capacity sehingga hasil target dapat bias.
- **Hook** — HTTP action terbatas untuk seed atau cleanup data test pada target.
- **Artifact** — file hasil seperti runner log, summary JSON, screenshot, atau browser error.
- **Terminal transaction** — transaction yang menyimpan status akhir, summary, dan audit secara konsisten.

## `finish.ts`: `finishRun`

Ini adalah terminal orchestrator. Dipanggil ketika executor/callback/safety guard menentukan run berakhir.

Urutan utama:

1. Load run, environment, target, dan integrity config.
2. Jika emergency stop, tunggu final Prometheus push sebentar.
3. `summarize` metrics.
4. `saturation` evidence.
5. `checkIntegrity` jika adapter tersedia.
6. Tentukan verdict dan caveats.
7. Cleanup test data.
8. Collect/upload artifacts.
9. Transaction terminal state + summary + audit.
10. Delete executor resource/cleanup.

Function harus idempotent terhadap state terminal agar duplicate signal tidak membuat hasil ganda.

## `summary.ts`

### `summarize(...)`

Menggunakan `summaryQueries` untuk p50/p95/p99, requests, errors, RPS, VUs, duration, dan load achievement. Juga memanggil journey dan browser helpers.

### `saturation(...)`

Mengambil CPU runner dan dropped iterations untuk menentukan apakah generator, bukan target, menjadi bottleneck.

### `journey(...)`

Mengambil step reached/completed/duration, payment confirmation, dan journey counters.

### `vitals(...)`

Mengambil LCP, INP, CLS, FCP, dan TTFB per browser step.

## `integrity.ts`

### `httpIntegrityAdapter(ctx, host, path)`

Membuat adapter read-only untuk target:

- Host Kubernetes → service proxy.
- Host biasa → HTTP fetch.
- Parse response melalui `integrityCountsOf`.
- Timeout 10 detik.

### `checkIntegrity` di `finish.ts`

Menentukan window run, memanggil adapter, dan menghasilkan counts + timeline entry.

Rule:

```text
oversold = 0
double charge = 0
charged without ticket = 0
```

Non-zero → verdict fail. Adapter tidak tersedia/gagal → caveat `integrity_not_verified`.

## `hooks.ts`

### `runHook(ctx, hook, hosts)`

Menjalankan HTTP POST/PUT/DELETE terbatas pada host target, dengan timeout dan allowlist check.

### `poolOf(ctx, targetId)`

Membaca test-data pool target.

### `seedTestData(ctx, targetId)`

Dipanggil sebelum executor create. Menyiapkan state target; hasil pass/fail masuk preflight.

### `cleanupTestData(ctx, run)`

Dipanggil saat finish, termasuk failure/abort, agar test berikutnya mulai dari state bersih. Menulis audit hasil cleanup.

## `artifacts.ts`

### `ArtifactStore`

Wrapper S3/MinIO:

- Upload object.
- Generate/access object metadata.
- Configuration dibaca lazily agar build/import tidak gagal.

### `collectArtifacts(executor, ctx, runId, scope)`

Mengambil:

- Runner logs (dibatasi `LOG_LINES`).
- k6 summary marker/file.
- Runner-uploaded screenshots/browser errors yang sudah tercatat.

Menyimpan object dan metadata `run_artifacts`.

## Terminal audit entry

`endEntry` membentuk timeline berdasarkan outcome/verdict:

- Completed/pass.
- Completed/fail threshold/integrity.
- Failed technical error.
- Aborted dengan structured reason.

Audit dan state terminal ditulis transactionally agar evidence tidak berbeda dari business state.

## Halaman yang menggunakan hasil

- `/runs` — terminal status dan verdict badge.
- `/runs/:id` — metrics, journey, integrity, caveat, baseline, release trend.
- Report route — self-contained HTML.
- Artifact viewer — logs, screenshot, JSON/error files.
- Approvals/history — timeline tetap dapat menunjukkan siapa dan mengapa.

## Ringkasan pemahaman

1. **Mengapa summary durable disimpan walau Prometheus punya metrics?** Raw metrics memiliki retention terbatas dan mahal untuk dibentuk ulang. PostgreSQL menyimpan angka keputusan utama agar history, report, baseline, dan release trend tetap tersedia setelah metrics expired.
2. **Apa beda threshold fail dan technical failure?** Threshold fail berarti execution berhasil mengukur target tetapi hasil melanggar budget; status dapat `completed` dengan verdict `fail`. Technical failure berarti test tidak menghasilkan execution yang dapat dipercaya, misalnya pod hilang atau Kubernetes error; statusnya `failed`.
3. **Mengapa cleanup tetap berjalan setelah abort?** Seeded account, cart, inventory, atau payment state dapat mencemari run berikutnya. Cleanup adalah finally-style responsibility, bukan hanya happy-path step.
4. **Apa beda journey integrity counter dan target adapter?** Journey counter melaporkan tindakan yang dilihat client k6. Target adapter membaca source server-side untuk merekonsiliasi oversell, duplicate charge, dan missing ticket. Client success tidak membuktikan database target benar.
5. **Mengapa audit terminal dan summary perlu transaction?** Jangan sampai DB mengatakan completed tanpa summary/evidence, atau audit mengatakan selesai padahal state rollback. Transaction menjaga terminal state, summary, dan timeline konsisten.
6. **Mengapa emergency stop menunggu final push?** k6 dapat mengirim remote-write terakhir sesaat setelah `endedAt`. Menunggu satu push interval mencegah summary kehilangan request/RPS terakhir dan berbeda dari Grafana/k6 summary.
