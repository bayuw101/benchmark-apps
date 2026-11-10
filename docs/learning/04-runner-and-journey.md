# Modul 04: Runner dan Journey Ticketing

## Tujuan

Memahami apa yang terjadi di dalam pod k6 sebelum request pertama dikirim, dan bagaimana journey ticketing menggunakan mock target.

## Dari TestRun ke pod

```text
Worker membuat TestRun
  → k6 Operator melihat custom resource
  → Operator membuat runner pod
  → Pod menjalankan runner image dari journeys/Dockerfile
  → journeys/src/main.ts memilih journey dari config
```

Worker tidak membuat pod secara manual. Ia membuat resource TestRun dan Operator menangani pod.

## Runner self-check

Sebelum VU berjalan, `packages/k6-lib/src/runner.ts`:

1. Membaca `RunnerConfig`.
2. Memanggil manifest endpoint dengan short-lived token.
3. Menghitung ulang hash manifest.
4. Membandingkan config, manifest, allowlist, dan protocol.
5. Memastikan approval masih valid.
6. Mengambil lease pertama.
7. Memeriksa test-data Secret jika diperlukan.
8. Mengirim callback verified atau refused.

Jika salah satu gagal, execution abort sebelum scenario mengirim traffic.

Endpoint terkait:

- `apps/web/src/app/api/runner/manifest/route.ts`
- `apps/web/src/app/api/runner/lease/route.ts`
- `apps/web/src/app/api/runner/callback/route.ts`

## Lease

Runner secara periodik bertanya ke platform:

> Apakah saya masih boleh berjalan?

Platform menjawab `continue` atau `stop`. Jika platform tidak dapat dijangkau sampai TTL habis, runner berhenti sendiri. Ini disebut fail closed.

Lease mencegah load terus berjalan ketika web dan worker tidak sehat.

## Request guard

`packages/k6-lib/src/guard.ts` membatasi:

- Host yang boleh diakses.
- Path yang boleh diakses.
- HTTP method yang boleh dipakai.
- Kesesuaian config dengan approved manifest.

NetworkPolicy Kubernetes memberi lapisan pembatasan tambahan. Guard di code dan network policy tidak saling menggantikan.

## Test data

Target dapat mempunyai pool fake identities. Database hanya menyimpan nama/path Secret, bukan credential.

Worker memasang Secret ke pod. `packages/k6-lib/src/testdata.ts` membaca file dan membagi identity berdasarkan execution segment agar dua pod tidak memakai identity yang sama.

Jika Secret wajib tetapi tidak ada atau rusak, runner menolak start.

## Struktur journey

```text
journeys/src/
├── main.ts
├── catalog.ts
├── browse-event/
├── checkout/
├── receive-poll/
└── scan-ticket/
```

Setiap journey mempunyai metadata dan implementation. Catalog dibangun ke runner image, lalu disinkronkan ke database.

## Checkout journey

Flow business:

```text
GET event
  → POST cart untuk hold seat
  → POST checkout
  → POST payment dengan Idempotency-Key
  → poll order confirmation
  → poll ticket issuance
```

File:

- `journeys/src/checkout/index.ts`
- `journeys/src/checkout/meta.ts`
- `infra/mock-target/server.mjs`

Journey mencatat:

- Step reached dan completed.
- Duration per step.
- Payment-to-confirmation latency.
- Order, seat, ticket, dan charge counters.
- HTTP metrics standar.

## Mock ticketing target

`infra/mock-target` adalah target yang benar-benar dipakai local benchmark. Root URL menampilkan UI ticketing, sedangkan API mendukung journey.

Business endpoint utama:

```text
GET  /events
GET  /events/:id
POST /carts
POST /checkouts
POST /payments
GET  /orders/:id
GET  /orders/:id/ticket
POST /scan
```

Admin endpoint local:

```text
POST /__admin/reset
GET  /__admin/integrity
GET/POST /__admin/config
```

Fault yang dapat disimulasikan:

- Latency dan jitter.
- Error rate.
- Oversell.
- Payment rate limit.
- Connection drop setelah charge.
- Idempotency diabaikan.
- Charge tanpa order/ticket.
- Target unhealthy.

Ini memungkinkan BTB menguji safety dan integrity tanpa menyentuh sistem ticketing nyata.

## Mengapa Idempotency-Key penting?

Jika payment berhasil tetapi koneksi putus sebelum response diterima, client harus retry. Dengan key yang sama, payment sandbox mengembalikan hasil lama tanpa charge baru.

Tanpa idempotency, retry dapat menyebabkan double charge.

## Latihan

1. Buka `http://localhost:8081` dan lakukan pembelian manual.
2. Di browser Network tab, catat endpoint yang dipanggil.
3. Baca handler endpoint yang sama di `server.mjs`.
4. Baca checkout journey dan cocokkan urutannya.
5. Jalankan `node --test infra/mock-target/server.test.mjs`.
6. Temukan test idempotency dan fault integrity.

## Checkpoint

1. Apa yang mencegah VU berjalan sebelum approval diverifikasi?
2. Mengapa manifest diverifikasi lagi di runner?
3. Apa yang terjadi jika lease endpoint mati?
4. Bagaimana identity dibagi antar-pod?
5. Mengapa idempotency key harus sama saat retry?
6. Apa beda journey counter dan target integrity check?
