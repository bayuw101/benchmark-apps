# 01: Startup, Context, dan Config

## Istilah yang dipakai di modul ini

- **Worker** — process Node.js background yang terus hidup untuk mengoordinasikan run. Worker bukan runner dan tidak mengirim load.
- **Context (`Ctx`)** — object yang membawa semua alat worker: config, database, Redis, Kubernetes, executor, Prometheus, dan artifact store.
- **BullMQ job** — pesan singkat di Redis untuk membangunkan worker, misalnya `dispatch` atau `stop`. Job bukan performance run itu sendiri.
- **Tick** — satu putaran pekerjaan timer. State tick menangani heartbeat, reconciliation, guard, dan dispatch; live tick mengambil metrics.
- **Heartbeat** — tanda ber-`TTL` di Redis bahwa worker masih hidup dan mengawasi runner.
- **Graceful shutdown** — proses berhenti teratur: tidak menerima job baru, menunggu pekerjaan aktif, lalu menutup koneksi.
- **Lock barrier** — mengambil lalu segera melepas lock untuk memastikan pemegang lock sebelumnya sudah selesai sebelum resource ditutup.

## Entry point: `main.ts`

`apps/worker/src/main.ts` adalah composition root: tempat dependency dibuat dan loop worker dimulai.

Urutan startup:

```text
loadConfig()
→ createDb()
→ Redis connection
→ Kubernetes client
→ Context object
→ BullMQ Worker
→ periodic timers
→ initial tick + liveTick
→ signal handlers
```

## `env.ts`

### `fromEnv(name, devDefault)`

Membaca environment variable. Development boleh memakai default; production menolak default yang tidak aman.

### `intFromEnv(name, fallback)`

Membaca integer config dan menolak nilai invalid.

### `dockerEnvironments()`

Menentukan environment mana yang memakai DockerExecutor. Mode ini development-only dan tidak boleh aktif di production.

### `loadConfig()`

Menghasilkan `WorkerConfig`, antara lain:

- Database dan Redis URL.
- Kubeconfig.
- Prometheus URL.
- Runner remote-write URL.
- Registry/image config.
- Namespace capacity.
- Lease secret/URL.
- Docker executor settings.

Dipakai sekali saat startup di `main.ts`.

## `context.ts`

### `Ctx`

Dependency bag yang diteruskan ke worker modules:

```text
cfg        WorkerConfig
db         Drizzle database
pool       pg Pool untuk advisory lock
redis      ioredis client
kube       Kubernetes API wrapper
executors  Kubernetes + Docker
prom       Prometheus client
artifacts  MinIO/S3 client
```

Keuntungan: function seperti `dispatch(ctx)` tidak mengimpor singleton global dan lebih mudah diuji atau diganti dependency-nya.

### `placement(ctx, environment, namespace)`

Memilih executor dan scope:

- Environment yang dikonfigurasi Docker → DockerExecutor + scope lokal.
- Selain itu → KubernetesExecutor + namespace Kubernetes.

Dipakai saat dispatch, reconcile, dan finish agar semua tahap memilih executor secara konsisten.

## `log.ts`

### `write(level, msg, fields)`

Menulis structured JSON log ke stdout/stderr. Production log shipper dapat mengirim output ini ke CloudWatch.

### `log`

Facade `info`, `warn`, dan `error`.

### `errorMessage(error)`

Mengubah unknown error menjadi string yang aman untuk log.

Log operasional berbeda dari `audit_logs`: log untuk diagnosis teknis; audit untuk bukti business action.

## BullMQ Worker di `main.ts`

```text
new Worker(RUNS_QUEUE, handler, { concurrency: 1 })
```

Handler:

1. Mengambil state advisory lock.
2. Jika job `stop`, memanggil `stopRun`.
3. Selalu memanggil `dispatch` sesudahnya agar slot kosong segera digunakan.

`concurrency: 1` hanya berlaku pada satu BullMQ Worker instance. Advisory lock tetap diperlukan untuk timer dan replica lain.

## `tick()`

Berjalan setiap `LIVE_INTERVAL_SEC` (5 detik):

1. Menulis heartbeat Redis untuk lease endpoint.
2. Mencoba state lock tanpa menunggu.
3. `reconcile(ctx)`.
4. `guardRunning(ctx, ...)`.
5. `dispatch(ctx)` jika ada run selesai/abort atau setiap tiga tick (~15 detik).

Jika lock sibuk, tick dilewati; tick berikutnya mencoba lagi.

## `liveTick()`

Berjalan setiap 5 detik dengan `LIVE_LOCK_KEY` berbeda. Memanggil `sampleLive(ctx)`.

Lock terpisah memastikan Prometheus/Redis live path yang lambat tidak menunda Stop atau reconciliation.

## `shutdown(signal)`

1. Tandai shutting down.
2. Hentikan timers.
3. Tutup BullMQ worker dan tunggu job selesai.
4. Ambil/lepas state dan live lock sebagai barrier.
5. Disconnect Redis.
6. Tutup PostgreSQL pool.
7. Exit.

Barrier kosong memastikan tidak ada tick lama yang masih bekerja ketika connection ditutup.

## Halaman yang terdampak

Startup module tidak dipanggil halaman secara langsung. Jika gagal:

- Run tetap queued.
- Live metrics berhenti diperbarui.
- Lease akhirnya menyuruh runner berhenti karena heartbeat hilang.
- UI menampilkan state dari PostgreSQL tetapi execution tidak maju.

## Ringkasan pemahaman

1. **Mengapa `db` dan `pool` keduanya ada di `Ctx`?** `db` adalah Drizzle interface untuk query domain yang typed. `pool` memberi akses ke satu physical PostgreSQL connection yang harus dipertahankan selama advisory lock. Keduanya memakai database yang sama, tetapi abstraksi dan lifecycle connection-nya berbeda.
2. **Mengapa live tick memakai lock key berbeda?** Sampling Prometheus/Redis tidak mengubah lifecycle state. Jika memakai state lock, query metrics yang lambat dapat menunda dispatch, reconciliation, atau emergency stop. Lock terpisah tetap menjamin hanya satu sampler tanpa menghambat safety operation.
3. **Mengapa BullMQ concurrency 1 belum cukup?** Nilai itu hanya menserialkan job pada satu BullMQ Worker instance. Periodic tick dan worker replica lain tetap dapat berjalan bersamaan. PostgreSQL advisory lock mengoordinasikan seluruh process dan replica.
4. **Mengapa heartbeat Redis ditulis oleh tick?** Lease endpoint perlu mengetahui bahwa ada worker yang masih mengawasi run. Jika heartbeat expired, runner tidak boleh terus menghasilkan load tanpa control plane dan akhirnya berhenti secara fail closed.
5. **Mengapa shutdown mengambil empty lock?** Empty callback berfungsi sebagai barrier. Shutdown menunggu pemegang lock sebelumnya selesai, segera memperoleh dan melepas lock, lalu aman menutup Redis/PostgreSQL tanpa memutus tick yang masih bekerja.
