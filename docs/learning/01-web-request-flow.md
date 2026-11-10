# Modul 01: Flow Request Web

## Tujuan

Setelah modul ini, kamu memahami bagaimana sebuah halaman Next.js mengambil data, bagaimana tindakan client menjadi request API, dan di mana authentication, validation, business logic, dan database access dilakukan.

## Model mental Next.js di BTB

```text
Browser
  → page.tsx atau client component
  → route.ts
  → withAuth / withRunnerAuth
  → server module
  → packages/core + Drizzle
  → PostgreSQL
  → JSON response
  → React Query / component state
  → UI diperbarui
```

Tidak semua file React berjalan di browser. File tanpa `"use client"` adalah Server Component secara default. File dengan `"use client"` berjalan di browser dan dapat memakai state, effect, event handler, dan React Query.

## Entry point aplikasi

Baca berurutan:

1. `apps/web/src/app/layout.tsx`
2. `apps/web/src/app/page.tsx`
3. `apps/web/src/app/(app)/layout.tsx`
4. `apps/web/src/components/app-frame.tsx`
5. `apps/web/src/middleware.ts`

Flow awal:

```text
Request /
  → app/page.tsx redirect ke halaman default
  → middleware memeriksa keberadaan session
  → (app)/layout.tsx memvalidasi session sebenarnya
  → layout mengambil project dan review count
  → AppFrame membuat shell, navigation, dan breadcrumb
  → page feature dirender di dalam shell
```

Middleware hanya filter awal. Authorization resource tetap dilakukan di route handler karena cookie yang ada belum tentu valid dan role belum tentu cukup.

## Contoh read flow: membuka halaman Runs

File utama:

1. `apps/web/src/app/(app)/runs/page.tsx`
2. `apps/web/src/components/runs/runs-view.tsx`
3. `apps/web/src/components/runs/use-runs.ts`
4. `apps/web/src/app/api/runs/route.ts`
5. `apps/web/src/lib/server/runs.ts`

Flow:

```text
RunsPage
  → RunsView
  → useRuns(projectId, filters)
  → GET /api/runs?...filters
  → withAuth(viewer)
  → queryRuns(...)
  → Drizzle query PostgreSQL
  → RunPage JSON
  → React Query cache
  → InProgressBand + RunHistory
```

### Peran setiap file

`page.tsx` seharusnya tipis. Ia menyusun page-level dependency dan role, bukan mengandung seluruh UI.

`runs-view.tsx` mengatur state tampilan: loading, error, empty, filter, pagination, dan komposisi component.

`use-runs.ts` mengatur komunikasi browser: query key, fetch, infinite pagination, polling, dan error transport.

`route.ts` adalah HTTP boundary: authentication, role, schema/query validation, status code, dan response.

`server/runs.ts` melakukan query dan membentuk data yang dibutuhkan UI.

## Contoh write flow: membuat run

File utama:

1. `apps/web/src/components/runs/create-run-form.tsx`
2. `apps/web/src/app/api/runs/route.ts`
3. `apps/web/src/lib/server/with-auth.ts`
4. `packages/contracts/src/schemas.ts`
5. `apps/web/src/lib/server/run-actions.ts`
6. `packages/core/src/policy.ts`

Flow:

```text
User submit form
  → client memvalidasi bentuk dasar dengan shared schema
  → POST /api/runs
  → withAuth memeriksa session + role + body size + schema
  → createRun
  → evaluatePlan
  → manifestOf + hashManifest
  → database transaction
  → response detail
  → navigation ke run baru
  → toast/loading feedback
```

Client validation memberi feedback cepat, tetapi server tetap mengulangi validation. Browser adalah untrusted boundary; request dapat dibuat tanpa UI.

## `withAuth` dan `withRunnerAuth`

Buka `apps/web/src/lib/server/with-auth.ts`.

`withAuth` menangani request pengguna:

- Session.
- Minimum role.
- Body size.
- Zod schema.
- Consistent error shape.

`withRunnerAuth` menangani request dari pod runner:

- HMAC token.
- Run ID binding.
- Body size.
- Optional body signature.
- Runner-specific schema.

Test `with-auth.test.ts` juga memindai route agar tidak ada route yang lupa memakai wrapper.

## Validation versus policy

Validation menjawab:

> Apakah bentuk input benar?

Contoh: `preset` harus salah satu enum yang dikenal.

Policy menjawab:

> Apakah tindakan ini diperbolehkan dalam kondisi sekarang?

Contoh: jumlah VU tidak boleh melampaui ceiling target.

Typical response:

- `400`: bentuk request salah.
- `401`: belum terautentikasi.
- `403`: role atau akses tidak cukup.
- `404`: resource tidak ditemukan atau tidak terlihat.
- `409`: state berubah atau conflict.
- `422`: bentuk valid tetapi melanggar business rule.

## Database access

Schema ada di `packages/core/src/db/schema.ts`. Web mengakses instance database melalui `apps/web/src/db/index.ts` dan server modules.

Gunakan transaction ketika beberapa perubahan harus berhasil bersama:

```text
ubah run
+ tulis audit
+ invalidasi approval
```

Tanpa transaction, sebagian perubahan dapat tersimpan sementara bagian lain gagal.

## Latihan trace

### Latihan A: filter Runs

1. Buka `/runs`.
2. Ubah satu filter.
3. Lihat URL query string berubah.
4. Lihat request `/api/runs` di Network tab.
5. Temukan parsing filter di route.
6. Temukan kondisi Drizzle di `queryRuns`.
7. Cocokkan response dengan row UI.

### Latihan B: unauthorized request

1. Buka test `with-auth.test.ts`.
2. Pilih satu kasus 401 dan satu kasus 403.
3. Ikuti branch kondisi di `withAuth`.
4. Jelaskan mengapa middleware saja tidak cukup.

## Checkpoint

1. Apa beda Server Component dan Client Component?
2. Mengapa `page.tsx` sebaiknya tipis?
3. Apa tanggung jawab route handler?
4. Apa beda validation dan policy?
5. Mengapa client dan server memakai schema yang sama?
6. Di mana query Runs dibuat?
7. Mengapa audit log perlu masuk transaction yang sama?

Lanjut ke [Modul 02](02-run-lifecycle.md) setelah kamu dapat menelusuri satu GET dan satu POST dari browser sampai database.
