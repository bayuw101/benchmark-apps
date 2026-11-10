# 00: Kamus Istilah Worker

Dokumen ini menjelaskan istilah worker dengan definisi BTB, bukan hanya definisi umum. Baca sebelum modul lain.

## Istilah lifecycle dan pekerjaan

### Run

Satu rencana performance test yang disimpan sebagai business entity di PostgreSQL. Run hidup lebih lama daripada job BullMQ dan memiliki status, manifest, approval, summary, verdict, audit, dan artifacts.

### Dispatch

Proses worker untuk melihat queued runs, menghitung capacity, memilih siapa yang mendapat slot, menjalankan preflight, lalu membuat workload untuk kandidat yang aman.

Analogi: petugas terminal yang menentukan bus mana boleh berangkat berikutnya.

```text
dispatch
→ baca queued + active
→ schedule
→ start kandidat
→ catat blocker waiter
```

### Dispatch pass

Satu putaran dispatch berdasarkan snapshot database terbaru. Jika kandidat gagal start dan mengembalikan slot, dispatch melakukan pass baru agar run di belakang dapat segera dipertimbangkan.

### Queue

Antrean pekerjaan. Di BTB ada dua konsep:

- Queued run di PostgreSQL: pekerjaan resmi yang durable.
- BullMQ queue di Redis: sinyal cepat untuk membangunkan worker.

### Job

Unit pekerjaan BullMQ seperti `dispatch` atau `stop`. Job biasanya selesai dalam detik, sedangkan run yang dipicunya dapat berlangsung berjam-jam.

### Sweep

Pemeriksaan periodik tanpa menunggu event. Dispatch sweep mencari queued runs setiap sekitar 15 detik, sehingga missed BullMQ enqueue dapat dipulihkan.

### Tick

Satu eksekusi timer worker. State tick menjalankan heartbeat, reconciliation, guard, dan kadang dispatch. Live tick mengambil metrics.

### Scheduler

Pure decision logic (`schedule`) yang menentukan queued run mana boleh mulai berdasarkan target dan namespace capacity. Scheduler tidak membuat pod.

### Slot

Jatah concurrency. BTB membatasi satu active run per target dan sejumlah active run per namespace. Slot dianggap terpakai oleh starting, running, dan stopping run.

### Capacity

Kemampuan sistem menerima workload baru, baik dari aturan concurrency maupun Kubernetes ResourceQuota CPU/memory.

### Blocker / `queuedBehind`

Run active atau queued lebih dahulu yang membuat run lain harus menunggu. Disimpan agar UI dapat menjelaskan antrean.

## Istilah safety dan koordinasi

### Advisory lock

Mutex logis lintas worker yang disediakan PostgreSQL. Semua state operation memakai key yang sama agar keputusan dispatch/reconcile/stop tidak berjalan bersamaan. Lock tidak mengunci seluruh tabel dan tidak dipegang selama performance test.

### Critical section

Bagian code yang harus dijalankan satu per satu, misalnya baca capacity → pilih run → ubah state. Advisory lock melindungi bagian ini.

### Lease

Izin hidup jangka pendek untuk runner. Runner memperbarui lease secara berkala dengan bertanya ke platform apakah ia boleh melanjutkan.

```text
runner → lease endpoint → continue / stop
```

Jika platform/worker heartbeat hilang sampai TTL habis, runner berhenti sendiri. Ini mencegah load tanpa pengawasan.

Analogi: izin kerja yang harus terus diperpanjang, bukan surat izin permanen.

### TTL (Time To Live)

Batas waktu sebuah data/izin dianggap valid. Contoh: heartbeat Redis, live sample, dan lease runner. Setelah TTL lewat, data dianggap expired.

### Heartbeat

Tanda periodik bahwa worker masih hidup dan mengawasi run. Disimpan di Redis dengan TTL. Lease endpoint menggunakannya untuk memutuskan `continue` atau `stop`.

### Fail closed

Ketika sinyal safety penting hilang, sistem memilih berhenti daripada terus berjalan. Contoh: lease expired atau telemetry hilang.

### Preflight

Serangkaian check sebelum workload dimulai: approval, manifest, target, window, test data, health, monitoring, dan capacity.

Web preflight memberi feedback cepat. Worker preflight adalah gate dekat waktu execution. Runner self-check adalah gate terakhir sebelum traffic.

### Guard

Pemeriksaan safety selama run berjalan, terutama telemetry dan target health. Preflight terjadi sebelum mulai; guard terjadi selama running.

### Allowlist

Daftar host, path, method, dan redirect yang diizinkan. Request di luar daftar ditolak oleh policy/runner guard dan dibatasi lagi oleh NetworkPolicy.

### Idempotent

Operasi aman dipanggil ulang tanpa menciptakan efek ganda yang salah. Dispatch dan finalization dirancang tahan duplicate signal. Payment memakai Idempotency-Key agar retry tidak double charge.

## Istilah state synchronization

### Reconciliation

Proses membandingkan business state PostgreSQL dengan actual state executor, lalu memperbaiki perbedaannya.

```text
DB starting + pod running → DB running
DB running + pod selesai → finish
DB active + pod hilang → failed/aborted
```

### Executor

Abstraksi tempat workload dijalankan. BTB memiliki KubernetesExecutor dan development-only DockerExecutor.

### Workload

Resource nyata yang menjalankan test: Kubernetes TestRun/pod atau Docker runner container.

### TestRun

Custom Resource milik k6 Operator. Worker membuat TestRun; operator menerjemahkannya menjadi runner pod.

### Runner

Process/container k6 yang memverifikasi manifest, memperbarui lease, menjalankan journey, mengirim traffic/metrics, dan memberi callback.

### Orphan

Workload BTB yang masih ada tetapi tidak mempunyai active run row yang sesuai. Orphan sweep menghapusnya agar tidak membocorkan load/resource.

### Callback

Pesan signed dari runner ke platform: verified, refused, stopped, atau finished. Callback memberi perspektif runner dan digabung dengan executor state.

### Conditional update

UPDATE dengan syarat state lama, misalnya `WHERE status = 'queued'`. Jika state sudah berubah, update tidak menimpa perubahan baru.

## Istilah metrics dan hasil

### Telemetry

Data observability yang menunjukkan runner dan target masih dapat dilihat: metrics, timestamp push, CPU, memory, dan lain-lain.

### Live sample

Snapshot metrics terbaru (VUs, RPS, p95, error rate) yang worker ambil dari Prometheus dan simpan sementara di Redis untuk UI.

### Remote write

Cara k6 mendorong metrics ke endpoint Prometheus, berbeda dari Prometheus scrape yang menarik metrics dari target.

### PromQL

Bahasa query Prometheus. Worker membuat query template yang selalu difilter run ID.

### Summary

Ringkasan durable hasil akhir: p50/p95/p99, error, peak RPS, VUs, duration, journey, browser vitals. Disimpan di PostgreSQL.

### Outcome

Hasil teknis execution: completed, failed, atau aborted beserta reason. Berasal dari exit code, executor state, callback, dan guard.

### Verdict

Penilaian produk: pass atau fail berdasarkan threshold dan integrity. Run dapat technically completed tetapi verdict fail.

### Caveat

Peringatan bahwa hasil harus dibaca dengan batasan tertentu, misalnya measurement gap, generator saturated, atau integrity not verified.

### Threshold

Batas performance/error yang harus dipenuhi, misalnya p95 ≤ 500 ms. Dapat mengaktifkan abort-on-fail.

### Saturation

Generator k6 kehabisan CPU/capacity atau menjatuhkan iteration. Jika generator saturated, hasil target dapat bias.

### Integrity

Kebenaran business data target: tidak oversold, tidak double charge, dan tidak charged-without-ticket.

### Artifact

File hasil seperti runner log, k6 summary, screenshot, atau browser error. Object disimpan di MinIO/S3; metadata di PostgreSQL.

## Istilah database dan code

### Source of truth

Penyimpanan authoritative untuk suatu concern. PostgreSQL adalah source of truth run lifecycle; Redis bukan.

### Durable

Data bertahan setelah process restart dan memang bagian dari record resmi.

### Transient

Data sementara yang boleh expired/dibangun ulang, seperti live sample Redis.

### Transaction

Sekumpulan perubahan PostgreSQL yang commit atau rollback bersama. State dan audit ditulis transactionally.

### Context (`Ctx`)

Object yang membawa dependency worker: config, database, pool, Redis, Kubernetes, executors, Prometheus, dan artifact store.

### Pure function

Function yang hasilnya ditentukan input dan tidak melakukan I/O eksternal. `schedule` adalah contoh; mudah diuji.

### Adapter

Penerjemah interface umum ke sistem konkret. KubernetesExecutor adalah adapter Kubernetes; integrity adapter menerjemahkan endpoint target menjadi integrity counts.

### Orchestrator

Function yang mengurutkan beberapa operasi tanpa mengandung seluruh algoritmanya. `finishRun` adalah terminal orchestrator.

## Ringkasan satu kalimat

```text
dispatch memilih kerja baru,
executor menjalankannya,
runner menghasilkan load,
lease dan guard menjaganya,
reconciliation menyelaraskan state,
live sampling menampilkan progress,
dan finishRun menyimpan hasil akhirnya.
```
