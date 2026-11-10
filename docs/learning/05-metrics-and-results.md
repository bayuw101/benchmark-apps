# Modul 05: Live Metrics dan Hasil

## Tujuan

Memahami perjalanan data measurement dari k6 sampai chart, verdict, report, dan artifact.

## Live metrics flow

```text
k6 runner
  → Prometheus remote write
  → worker query setiap 5 detik
  → LiveSample disimpan ke Redis
  → Next.js SSE endpoint membaca Redis
  → React menerima event
  → chart dan metric card diperbarui
```

File:

- `apps/worker/src/prometheus.ts`
- `apps/worker/src/live.ts`
- `apps/worker/src/plan.ts` — live queries
- `apps/web/src/app/api/runs/[id]/live/route.ts`
- `apps/web/src/components/runs/live-run.tsx`

## Mengapa melalui worker dan Redis?

Jika setiap browser query Prometheus sendiri, 20 viewer membuat 20 query identik. Worker melakukan satu query loop per active run dan menyimpan hasil yang dapat dibaca semua viewer.

Redis cocok karena live sample cepat dan sementara. Summary durable tetap masuk PostgreSQL.

## SSE

Server-Sent Events adalah stream satu arah server ke browser melalui HTTP. BTB membutuhkan server mengirim update, tetapi browser tidak perlu mengirim pesan melalui koneksi yang sama, sehingga SSE lebih sederhana daripada WebSocket.

## Summary akhir

`apps/worker/src/summary.ts` mengambil metrics akhir, misalnya:

- p50, p95, p99.
- Error rate.
- Peak RPS.
- Max VUs.
- Intended versus achieved load.
- Dropped iterations.
- Journey step metrics.
- Browser vitals.

Summary disimpan di `run_summaries`, sehingga hasil penting tetap tersedia setelah raw Prometheus metrics expired.

## Integrity

Journey counter menunjukkan apa yang dilihat client. Integrity adapter memeriksa keadaan target dari sisi server.

Target mock menghitung:

- Oversold seats.
- Double charges.
- Charged without ticket.

Angka harus nol. Jika non-zero, verdict fail meskipun latency memenuhi threshold.

Jika target tidak menyediakan adapter atau endpoint gagal dibaca, caveat `integrity_not_verified` ditambahkan.

File:

- `apps/worker/src/integrity.ts`
- `packages/core/src/integrity.ts`
- `infra/mock-target/server.mjs` — `/__admin/integrity`

## Verdict versus caveat

Verdict menjawab:

> Apakah test lulus?

Caveat menjawab:

> Apakah ada batasan yang membuat hasil perlu dibaca dengan hati-hati?

Contoh caveat:

- `measurement_gap`: ada gap measurement.
- `generator_saturated`: generator kehabisan kapasitas sehingga hasil target tidak murni.
- `integrity_not_verified`: data correctness target tidak berhasil diperiksa.

## Generator saturation

Worker memeriksa evidence seperti CPU runner dan dropped iterations. Jika generator sendiri saturated, latency tinggi mungkin berasal dari generator, bukan target.

`GOMEMLIMIT` dipasang pada runner untuk mencegah memory bertumbuh sampai melewati limit pod saat soak test panjang.

## Artifact flow

```text
runner log/summary/screenshot
  → runner upload endpoint atau worker collection
  → MinIO object
  → run_artifacts metadata di PostgreSQL
  → authorized artifact route
  → user download/view
```

File:

- `apps/worker/src/artifacts.ts`
- `apps/web/src/app/api/runner/artifacts/route.ts`
- `apps/web/src/app/api/runs/[id]/artifacts/[name]/route.ts`
- `apps/web/src/components/runs/artifact-viewer.tsx`

User tidak mendapat akses bucket langsung. Route memeriksa akses terhadap run sebelum memberikan file atau short-lived URL.

## Report

Report HTML merangkum manifest, approval, load, metrics, integrity, baseline, trend, verdict, caveat, dan version.

File:

- `apps/web/src/app/api/runs/[id]/report/route.ts`
- report builder di library runs.

## Latihan live trace

Saat run aktif:

1. Query run ID di Prometheus.
2. Cari `btb:run:<id>:samples` di RedisInsight.
3. Lihat SSE request di Network tab.
4. Cocokkan timestamp dan nilai dengan chart.
5. Setelah selesai, bandingkan raw metrics dengan row `run_summaries`.

## Checkpoint

1. Mengapa live sample disimpan di Redis tetapi summary di PostgreSQL?
2. Mengapa viewer tidak query Prometheus langsung?
3. Apa beda journey counter dan integrity adapter?
4. Apa beda verdict dan caveat?
5. Mengapa generator saturation penting?
6. Bagaimana authorization artifact dilakukan?
