# Modul 00: Orientasi

## Apa yang dilakukan BTB?

BTB mengatur performance test terhadap sistem ticketing agar aman, dapat diulang, dan dapat diaudit.

Tanpa BTB, seorang engineer dapat menjalankan k6 langsung dari laptop. Cara itu berisiko:

- Target yang dimasukkan bisa salah.
- Beban bisa melebihi batas yang aman.
- Test dapat terus berjalan ketika control plane mati.
- Tidak jelas siapa yang menyetujui test.
- Hasil sulit dibandingkan dengan release sebelumnya.
- Tidak ada audit trail yang dapat dipercaya.

BTB memisahkan orang yang meminta test dari proses yang menghasilkan load.

```text
Engineer membuat rencana test
  → BTB memeriksa policy
  → Approver menyetujui manifest tertentu jika diperlukan
  → Worker menjadwalkan eksekusi
  → k6 mengirim load
  → BTB menyimpan metrics, safety event, hasil, dan evidence
```

Web tidak menjalankan k6 secara langsung. Request web seharusnya selesai dengan cepat, sedangkan performance test bisa berjalan beberapa menit sampai beberapa jam.

## Stack dalam bahasa sederhana

| Teknologi | Tugas di BTB | Analogi sederhana |
| --- | --- | --- |
| Next.js dan React | UI dan HTTP API | Meja depan |
| PostgreSQL dan Drizzle | Business state yang durable | Buku catatan resmi |
| Redis dan BullMQ | Memberi sinyal pekerjaan ke worker dan menyimpan live data sementara | Radio dispatcher |
| Node worker | Mengatur pekerjaan yang berjalan lama | Operator ruang kontrol |
| Kubernetes dan k6 Operator | Menjalankan dan membatasi workload k6 | Fasilitas pengujian |
| k6 | Menghasilkan traffic dan measurement | Mesin pembuat beban |
| Prometheus | Menyimpan metrics berdasarkan waktu | Alat perekam |
| MinIO atau S3 | Menyimpan report dan file | Arsip evidence |
| Grafana | Analisis metrics yang lebih dalam | Dashboard monitoring |

## Struktur repository

```text
apps/web        UI dan API yang berinteraksi dengan pengguna
apps/worker     Coordinator eksekusi di background
packages/       Contract dan aturan bisnis yang digunakan bersama
journeys/       Scenario performance test k6
infra/          Service local dan konfigurasi Kubernetes
scripts/        Otomasi workflow developer
docs/           Product, architecture, operations, evidence, dan materi belajar
```

Pemisahan tanggung jawab yang paling penting:

```text
apps/web       menerima niat pengguna
packages/core  menentukan apakah tindakan diperbolehkan
apps/worker    mengatur lifecycle eksekusi
packages/k6-lib dan journeys  menghasilkan traffic secara terkendali
```

## Lima jenis flow yang perlu dipahami

### Request flow

Tindakan browser menjadi HTTP request. Request melewati authentication, validation, domain logic, database transaction, lalu menghasilkan response.

Contoh:

```text
Klik Create run
  → POST /api/runs
  → validasi input
  → policy check
  → simpan run
  → tampilkan detail run
```

### Command flow

Perubahan durable meminta worker melanjutkan pekerjaan asynchronous.

Contoh:

```text
Klik Start
  → status PostgreSQL menjadi queued
  → BullMQ membangunkan worker
```

### Execution flow

Worker memilih queued run, menjalankan preflight, membuat workload, lalu mengawasinya sampai selesai.

### Data flow

k6 mengirim metrics ke Prometheus. Worker membaca metrics dan menaruh live sample di Redis. Web mengalirkannya ke React melalui SSE.

### Recovery flow

Worker secara berkala membandingkan state PostgreSQL dengan workload executor. Jika pesan queue terlewat atau worker restart, reconciliation dapat melanjutkan pengawasan.

## Mengapa memakai beberapa data store?

### PostgreSQL: sumber kebenaran

PostgreSQL menyimpan data yang tidak boleh hilang:

- Run dan statusnya.
- Manifest dan hash.
- Approval.
- Audit log.
- Summary hasil.
- Metadata artifact.

Jika Redis dihapus, status resmi run masih ada.

### Redis: sinyal dan data cepat

Redis menyimpan:

- Struktur internal BullMQ.
- Worker heartbeat.
- Live sample sementara.

Redis bukan sumber kebenaran lifecycle run.

### Prometheus: time-series metrics

Prometheus menyimpan nilai yang berubah sepanjang waktu, misalnya RPS, p95, error rate, CPU, memory, dan VUs.

BTB hanya memiliki satu Prometheus lokal, yaitu Prometheus di cluster kind. Runner pod menulis metrics ke service Kubernetes tersebut dan worker membacanya melalui network kind. Compose tidak menjalankan Prometheus kedua karena aplikasi tidak menggunakannya.

### MinIO: file hasil

Report HTML, runner log, screenshot, browser error, dan summary file disimpan sebagai object. PostgreSQL hanya menyimpan metadata object tersebut.

### Kubernetes: workload nyata

PostgreSQL dapat menyatakan run sedang `running`, tetapi Kubernetes yang mengetahui apakah pod runner benar-benar hidup. Worker merekonsiliasi keduanya.

## Menjalankan sistem

Full local stack:

```sh
pnpm dev:up
pnpm dev
pnpm dev:status
```

Untuk pekerjaan UI saja:

```sh
pnpm dev:up:ui
pnpm dev
```

Pada mode UI-only, data tersedia tetapi run tidak benar-benar dieksekusi.

Buka:

- Web: `http://localhost:3001`
- Ticketing target: `http://localhost:8081`
- RedisInsight: `http://localhost:5540`
- Prometheus: jalankan `kubectl -n monitoring port-forward svc/prometheus 9091:9090`, lalu buka `http://localhost:9091`
- MinIO: `http://localhost:19001`

## Latihan observasi pertama

1. Buka web app dan ticketing target berdampingan.
2. Buka RedisInsight dan cari `bull:*` serta `btb:*`.
3. Buka Prometheus dan jalankan query `up`.
4. Buka halaman Runs dan pilih satu seeded completed run.
5. Bedakan nilai yang berasal dari business data dan nilai yang berasal dari metrics.
6. Jalankan `pnpm dev:status` dan cocokkan setiap service dengan diagram stack.

## Checkpoint

Jawab tanpa melihat dokumen:

1. Mengapa worker dipisahkan dari Next.js?
2. Mengapa PostgreSQL menjadi sumber kebenaran, bukan BullMQ?
3. Data apa yang disimpan Prometheus tetapi tidak disimpan lengkap di PostgreSQL?
4. Apa yang terjadi pada queued run jika enqueue ke BullMQ gagal?
5. Proses mana yang boleh membuat k6 TestRun?
6. Apa perbedaan command flow dan execution flow?
7. Mengapa Kubernetes state perlu dibandingkan dengan database state?

Lanjutkan ke [Modul 01](01-web-request-flow.md) setelah kamu dapat menggambar proses utama dan data store dari ingatan.
