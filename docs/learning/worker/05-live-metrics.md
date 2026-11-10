# 05: Live Metrics

## Istilah yang dipakai di modul ini

- **Metric** — angka bernama yang berubah sepanjang waktu, misalnya VUs, RPS, p95, atau error rate.
- **Time series** — rangkaian sample metric dengan kombinasi label tertentu sepanjang waktu.
- **PromQL** — bahasa query Prometheus.
- **Remote write** — runner mendorong metrics ke Prometheus; ini berbeda dari Prometheus scrape yang menarik metrics.
- **Live sample** — snapshot metrics terbaru yang worker bentuk untuk UI dan simpan sementara di Redis.
- **SSE (Server-Sent Events)** — stream HTTP satu arah dari web ke browser untuk mengirim update live.
- **TTL** — batas umur key Redis; sample lama otomatis expired.
- **Stale** — sample ada tetapi terlalu lama sehingga tidak boleh dianggap kondisi sekarang.

## `prometheus.ts`

Class `Prometheus` membungkus Prometheus HTTP API.

Tanggung jawab:

- Readiness check.
- Instant query pada timestamp tertentu.
- Range/query helpers.
- Parse response dan error.

Ia tidak menentukan PromQL business; query builders berada di `plan.ts`.

## `live.ts`: `sampleLive(ctx)`

Flow:

```text
query semua running runs
→ untuk setiap run, tentukan browser/non-browser
→ liveQueries(runId, browser)
→ Prometheus query
→ bentuk LiveSample
→ RPUSH Redis list
→ set TTL
```

Redis key berasal dari `packages/contracts`:

```text
btb:run:<runId>:samples
```

Sample berisi data seperti:

- Timestamp.
- VUs.
- RPS.
- p95/p99.
- Error rate.
- Threshold.

Worker menyimpan satu sample per run per tick, bukan satu loop per viewer.

## Mengapa lock terpisah?

Live sampling dapat lambat karena Prometheus atau Redis. Ia memakai `LIVE_LOCK_KEY`, sehingga tidak menahan state lock untuk:

- Emergency stop.
- Reconciliation.
- Dispatch.

Hanya satu worker replica melakukan sampling untuk menghindari duplicate samples.

## Dari Redis ke UI

```text
sampleLive
→ Redis list
→ GET /api/runs/:id/live (SSE)
→ LiveRun component
```

Runs list juga membaca latest sample melalui `apps/web/src/lib/server/runs.ts` untuk In Progress cards.

Halaman:

- `/runs` — p95, VUs, RPS pada active cards.
- `/runs/:id` — chart dan detail live.

## Failure behavior

- Prometheus query gagal → warning log, sample tidak ditulis.
- Redis write gagal → warning log, UI tidak mendapat update baru.
- PostgreSQL tetap menyimpan run state.
- Safety guard terpisah dapat mendeteksi telemetry loss dan menghentikan run.

UI harus memperlakukan sample lama sebagai delayed/stale, bukan menganggap nol.

## PromQL builders

`plan.ts` menyediakan `liveQueries(runId, browser)` agar:

- Semua query memfilter `testid`.
- Protocol dan browser metric konsisten.
- URL/client tidak boleh mengirim arbitrary PromQL.

Ini adalah security dan maintainability boundary.

## Observasi runtime

1. Mulai smoke run.
2. Buka Prometheus melalui port-forward.
3. Cari series `testid="RUN-..."`.
4. Buka RedisInsight dan cari key sample.
5. Buka browser Network dan lihat SSE.
6. Cocokkan timestamp ketiganya.

## Ringkasan pemahaman

1. **Mengapa web tidak query Prometheus langsung untuk setiap viewer?** Dua puluh viewer akan menghasilkan dua puluh query identik. Worker melakukan satu loop per active run, Redis membagikan hasilnya, dan SSE mengirim sample yang sama ke semua viewer.
2. **Mengapa Redis sample bukan source of truth status run?** Sample bersifat transient, dapat stale/expired, dan hanya menggambarkan measurement terakhir. PostgreSQL menyimpan lifecycle resmi; executor memberi kenyataan workload.
3. **Apa yang terjadi jika Redis mati?** Run dan history tetap ada di PostgreSQL, runner/executor dapat tetap berjalan, tetapi BullMQ wake-up dan live UI terganggu. Periodic sweep dapat memulihkan queued work setelah worker/Redis tersedia; safety lease/telemetry dapat menghentikan run jika monitoring tidak aman.
4. **Mengapa client tidak boleh mengirim PromQL bebas?** Arbitrary query dapat mahal, membocorkan metric/label lintas project, dan membuat API sulit dikontrol. Server-owned templates memastikan filter run ID, batas query, dan bentuk hasil konsisten.
5. **Mengapa live lock berbeda dari state lock?** Live sampling hanya observability dan boleh skip. State operation menentukan lifecycle/safety dan harus tetap responsif. Query Prometheus atau Redis yang lambat tidak boleh menahan emergency stop.
