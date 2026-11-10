# 02: Lock, Queue, Dispatch, dan Preflight

## Istilah yang dipakai di modul ini

- **Dispatch** — proses mencari queued run yang dapat dimulai sekarang, bukan proses menjalankan traffic. Dispatch membaca antrean, menghitung slot, melakukan preflight, lalu meminta executor membuat workload.
- **Dispatch pass** — satu putaran dispatch berdasarkan snapshot database terbaru. Pass diulang jika kandidat gagal dan slot berubah.
- **Scheduler** — pure function yang memutuskan siapa boleh mulai dan siapa harus menunggu. Scheduler tidak mengubah database dan tidak membuat pod.
- **Slot** — jatah concurrency untuk target atau namespace. Starting, running, dan stopping masih memakai slot.
- **Preflight** — pemeriksaan sebelum workload dibuat: approval, manifest, health, monitoring, test data, dan capacity.
- **Advisory lock** — mutex lintas process dari PostgreSQL yang membuat state operation berjalan satu per satu.
- **`queuedBehind`** — ID run yang saat ini menjadi blocker, disimpan agar alasan antre dapat ditampilkan UI.
- **Settled** — kondisi ketika keputusan satu pass berhasil diterapkan dan tidak perlu membaca ulang state.

## `lock.ts`

### `LOCK_KEY`

Locker logis untuk semua worker state mutation: dispatch, reconcile, dan stop.

### `LIVE_LOCK_KEY`

Locker terpisah untuk live sampling.

### `withLock(pool, fn, key)`

- Meminjam satu physical PostgreSQL client.
- Menunggu `pg_advisory_lock(key)`.
- Menjalankan callback.
- Unlock pada `finally` memakai connection yang sama.
- Release client.

Dipakai oleh BullMQ handler dan shutdown barrier.

### `tryWithLock(pool, fn, key)`

Memakai `pg_try_advisory_lock`. Jika lock sedang dipegang process/replica lain, return `undefined` dan tidak menunggu.

Dipakai periodic tick/liveTick agar timer tidak menumpuk.

## `dispatch.ts`: flow utama

```text
dispatch(ctx)
  → dispatchPass maksimal 5 kali
  → query queued + active
  → schedule(...)
  → startRun untuk kandidat
  → simpan queuedBehind untuk waiter
```

### `dispatch(ctx)`

Mengulang pass maksimal `MAX_PASSES = 5`. Pass tambahan diperlukan jika kandidat gagal preflight dan melepas slot untuk run di belakangnya.

### `dispatchPass(ctx)`

1. Query hanya field scheduling: ID, status, target, namespace, blocker.
2. Ambil status `queued`, `starting`, `running`, `stopping`.
3. Urutkan berdasarkan `startRequestedAt`, lalu run ID.
4. Pisahkan queued dan active.
5. Panggil pure `schedule()`.
6. Kandidat start → `startRun`.
7. Kandidat wait → update `queuedBehind` jika berubah.
8. Return apakah state sudah settled.

Output ini dipakai UI `/runs` untuk menjelaskan siapa yang memblokir queued run.

### `startRun(ctx, id)`

Worker-side start, berbeda dari web `startRun`.

Web start:

```text
approved → queued
```

Worker start:

```text
queued → preflight → executor create → starting
```

Urutan worker start:

1. Load run, environment, target, runner protocol, dan test-data pool.
2. Pastikan run masih queued.
3. Pilih executor/scope via `placement`.
4. Parse manifest dan hitung parallelism/resources/config.
5. Verifikasi stored manifest hash.
6. `approvalCheck`.
7. `workerPreflight` secara parallel.
8. Jika gagal, simpan preflight/audit dan kembalikan ke `approved` atau terminal safety state.
9. Seed test data.
10. Claim run secara conditional menjadi `starting` dan simpan worker version.
11. `executor.create(spec)`.
12. Jika create gagal, finalisasi sebagai failure dan cleanup.

Conditional update mencegah state baru ditimpa jika user/worker lain telah mengubah run.

### `approvalCheck(ctx, run)`

Membaca approval rows dan memakai `approvalsSatisfied` terhadap current manifest hash, waktu, environment, preset, dan starter. Hasilnya `Check` pass/fail.

### `workerPreflight(...)`

Menggabungkan check:

- Approval.
- Target allowlist/validity.
- Execution window.
- Test-data readiness.
- Target health.
- Monitoring readiness.
- Runner capacity/quota.

Check dekat waktu execution penting karena kondisi dapat berubah setelah web preflight.

### `probeTarget(ctx, host, healthPath)`

- Host Kubernetes Service → proxy melalui Kubernetes API.
- Host biasa/local → HTTP fetch langsung.
- Timeout 5 detik.
- Menghasilkan preflight `Check` yang dapat ditampilkan UI.

## `plan.ts`: `schedule`

Input:

```text
queued runs
active runs
perNamespace limit
```

Aturan:

- Maksimal satu active run per target.
- Maksimal `perNamespace` active run per namespace.
- Queued dipertimbangkan FIFO.

Output:

```ts
{ id, start: true }
```

atau:

```ts
{ id, start: false, behind: "RUN-..." }
```

`plan.test.ts` adalah cara termudah memahami semua edge case scheduler.

## Hubungan UI

| Worker data | UI |
| --- | --- |
| `queuedBehind` | In Progress queued card |
| Preflight result | Run detail preflight checklist |
| `starting` | In Progress card dan detail status |
| Audit entries | Run timeline |
| Failure reason | Toast/detail setelah refresh |

## Ringkasan pemahaman

1. **Mengapa dispatch dapat melakukan beberapa pass?** Kandidat pertama dapat gagal preflight dan mengembalikan slot. Pass berikutnya membaca state terbaru agar run di belakangnya dapat langsung memakai slot tanpa menunggu sweep 15 detik berikutnya. Jumlah pass dibatasi agar satu dispatch tidak loop tanpa akhir.
2. **Apa beda web `startRun` dan worker `startRun`?** Web memvalidasi permintaan pengguna lalu mengubah `approved → queued`. Worker mengambil queued run, mengulang check yang sensitif waktu, membuat workload, lalu mengubah `queued → starting`.
3. **Mengapa query dispatch hanya mengambil sedikit kolom?** Scheduler hanya membutuhkan ID, status, target, namespace, dan blocker. Manifest, summary, artifact, serta relasi lain baru dibaca untuk kandidat yang benar-benar mendapat slot. Ini mengurangi data dan kerja database.
4. **Mengapa `stopping` masih memakai slot?** Status tersebut hanya berarti stop sudah diminta. Pod/container mungkin masih hidup atau masih mengirim traffic. Slot baru aman setelah executor mengonfirmasi workload terminal/dihapus.
5. **Mengapa worker mengulang approval dan health check?** Kondisi dapat berubah setelah web merespons: approval expired/dicabut, target unhealthy, monitoring down, capacity habis, atau manifest berubah. Worker adalah gate terakhir sebelum membuat workload.
6. **Mengapa queued blocker disimpan di PostgreSQL?** Agar alasan antre durable dan dapat dibaca semua web replica/UI tanpa menjalankan scheduler di browser. UI dapat menunjukkan `waiting for RUN-...` dan scope limit yang berlaku.
