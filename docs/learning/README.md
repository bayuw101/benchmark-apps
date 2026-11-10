# Kursus Memahami Codebase BTB

Kursus ini ditujukan untuk developer yang bisa membaca TypeScript, tetapi belum memahami hubungan antarbagian BTB, aliran data, aliran request, dan cara sebuah fitur bekerja dari UI sampai runner k6.

Jangan membaca repository dari file pertama sampai terakhir. Cara yang lebih efektif adalah mempelajari satu **vertical slice**: mulai dari tindakan pengguna, ikuti sampai ke API, aturan bisnis, database, queue, worker, runner, lalu kembali ke UI.

## Cara menggunakan kursus ini

Untuk setiap modul:

1. Baca model mental singkatnya.
2. Buka hanya file dan simbol yang disebutkan.
3. Prediksi flow sebelum membaca diagram yang tersedia.
4. Jalankan latihan observasi di local environment.
5. Jawab checkpoint tanpa melihat dokumen.
6. Tulis ulang penjelasannya dengan kata-katamu sendiri.

Dokumen pendamping:

- [Codebase guide](../architecture/codebase-guide.md) — referensi arsitektur teknis.
- [Codebase learning path](../architecture/codebase-learning-path.md) — checklist pembelajaran ringkas.
- [Runbook](../operations/runbook.md) — perintah operasional dan troubleshooting.
- [PRD](../product/prd.md) — tujuan produk dan acceptance criteria.

## Peta kursus

| Modul | Topik | Hasil pembelajaran |
| --- | --- | --- |
| 00 | [Orientasi](00-orientation.md) | Mengenal repository, proses, data store, dan cara membaca flow |
| 01 | [Flow request web](01-web-request-flow.md) | Memahami page, component, route handler, auth wrapper, dan query database |
| 02 | [Lifecycle sebuah run](02-run-lifecycle.md) | Memahami Create, Edit, manifest, policy, approval, Start, Stop, dan Finish |
| 03 | [Worker dan queue](03-worker-and-queue.md) | Memahami BullMQ, Redis, scheduler, lock, preflight, executor, dan reconciliation |
| 04 | [Runner dan journey ticketing](04-runner-and-journey.md) | Memahami image k6, verifikasi runner, lease, test data, journey, dan mock target |
| 05 | [Live metrics dan hasil](05-metrics-and-results.md) | Memahami Prometheus, Redis, SSE, summary, integrity, report, dan artifact |
| 06 | [Peta fitur](06-feature-map.md) | Memahami Login, Projects, Runs, Approvals, Scenarios, Admin, dan Report |
| 07 | [Flow debugging](07-debugging-flows.md) | Menyelidiki run queued, stuck, aborted, failed, dan data yang tidak konsisten |
| Worker | [Deep dive worker](worker/README.md) | Membedah seluruh file, function, hubungan, lifecycle, dan efek worker pada UI |

## Template universal untuk membaca flow

Gunakan pertanyaan berikut setiap kali mempelajari fitur:

```text
1. Trigger       Apa yang dilakukan pengguna atau sistem?
2. Presentation  Page atau component mana yang menampilkannya?
3. Transport     HTTP, SSE, atau pesan BullMQ apa yang melewati boundary?
4. Validation    Schema, auth, role, dan policy apa yang diperiksa?
5. Domain        Fungsi mana yang mengambil keputusan bisnis?
6. Persistence   Data PostgreSQL, Redis, Prometheus, atau MinIO apa yang berubah?
7. Async work    Worker, executor, atau runner mana yang melanjutkan pekerjaan?
8. Feedback      Apa yang dilihat pengguna saat berhasil atau gagal?
9. Recovery      Apa yang terjadi jika salah satu proses mati di tengah flow?
```

## Cara membedakan layer

Ketika membaca sebuah file, tanyakan file itu berada di layer mana:

| Layer | Pertanyaan utama |
| --- | --- |
| UI | Apa yang ditampilkan dan tindakan apa yang tersedia? |
| API | Siapa yang boleh meminta dan apakah bentuk input valid? |
| Domain | Apakah tindakan ini diperbolehkan menurut aturan bisnis? |
| Persistence | Apa yang harus disimpan secara durable? |
| Queue | Proses mana yang perlu dibangunkan? |
| Worker | Pekerjaan asynchronous apa yang harus dikoordinasikan? |
| Executor | Workload nyata dijalankan di mana? |
| Runner | Request apa yang dikirim ke target? |
| Observability | Bagaimana kita mengetahui apa yang terjadi? |

## Kecepatan belajar yang disarankan

Selesaikan satu modul per sesi. Modul 02 sampai 05 lebih panjang dan wajar jika membutuhkan dua atau tiga sesi.

Ukuran keberhasilan bukan jumlah file yang sudah dibaca. Kamu dianggap memahami satu flow ketika bisa mengambil satu run ID dan menelusurinya melalui semua layer terkait tanpa menebak.
