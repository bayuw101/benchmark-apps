# Modul 02: Lifecycle Sebuah Run

## Tujuan

Modul ini mengikuti satu run dari form Create sampai hasil akhir. Ini adalah flow terpenting di BTB.

## Istilah utama

### Plan

Pilihan pengguna: scenario version, target, environment, preset, network profile, dan release ID.

### Resolved plan

Plan setelah semua referensi catalog ditemukan dan angka load dihitung.

### Manifest

Instruksi eksekusi final dan immutable: target, load, duration, threshold, image, journey, dan allowlist.

### Manifest hash

Sidik jari SHA-256 dari canonical JSON manifest. Approval terikat pada hash ini. Mengubah manifest menghasilkan hash berbeda dan membatalkan approval lama.

File:

- `packages/core/src/policy.ts`
- `packages/core/src/manifest.ts`
- `packages/contracts/src/index.ts`

## State machine

```text
draft
  ├── low-risk staging ─────────────────► approved
  └── butuh manusia ─► pending_approval ─► approved

approved → queued → starting → running → completed
                │         │         ├──→ failed
                │         │         └──→ aborted
                └─────────┴────────────→ approved jika Start diblokir
```

Status menjelaskan keadaan eksekusi. Verdict menjelaskan apakah hasil memenuhi threshold dan integrity rule. Run dapat `completed` tetapi verdict `fail`.

## Flow Create

```text
CreateRunForm
  → POST /api/runs
  → runPlanInputSchema
  → createRun
  → catalog + evaluatePlan
  → manifestOf + hashManifest
  → transaction:
      INSERT runs
      INSERT auto-approval jika eligible
      INSERT audit_logs
  → response RunDetail
```

Baca:

1. `apps/web/src/components/runs/create-run-form.tsx`
2. `apps/web/src/app/api/runs/route.ts`
3. `apps/web/src/lib/server/run-actions.ts` — `createRun`
4. `packages/core/src/policy.ts` — `evaluatePlan`, `manifestOf`
5. `packages/core/src/manifest.ts`

Pertanyaan saat membaca:

- Dari mana scenario dan target berasal?
- Kapan policy violation menghasilkan 422?
- Kapan run langsung `approved`?
- Data apa yang masuk audit?

## Flow Edit

```text
Edit form
  → PATCH /api/runs/:id
  → pastikan status editable
  → evaluate plan baru
  → buat manifest + hash baru
  → transaction:
      UPDATE run
      approval lama tidak lagi cocok dengan hash
      INSERT audit
```

Approval tidak harus dihapus secara fisik untuk menjadi tidak valid. `approvalsSatisfied` hanya menghitung approval yang cocok dengan hash saat ini dan belum kedaluwarsa.

## Flow Approval

```text
Approver membuka inbox
  → GET data approval
  → membuka review sheet
  → POST /api/runs/:id/approve
  → cek role, starter, identity unik, hash, window
  → INSERT approval + audit
  → jika jumlah cukup: pending_approval → approved
```

Baca:

- `apps/web/src/components/approvals/approvals-view.tsx`
- `apps/web/src/components/approvals/review-sheet.tsx`
- `apps/web/src/app/api/runs/[id]/approve/route.ts`
- `apps/web/src/lib/server/approvals.ts`
- `packages/core/src/approvals.ts`

## Flow Start

```text
Klik Start
  → POST /api/runs/:id/start
  → load run terbaru
  → re-check policy
  → re-check manifest hash
  → re-check approval dan window
  → web preflight
  → transaction:
      approved → queued
      simpan startRequestedAt dan preflight
      tulis audit
  → enqueue BullMQ dispatch
  → UI menunjukkan queued
```

Mengapa semua diperiksa ulang? Karena run mungkin dibuat kemarin: approval bisa expired, ceiling bisa berubah, target bisa dinonaktifkan, atau manifest bisa diedit.

Mengapa commit database dilakukan sebelum enqueue? Agar worker tidak pernah menerima pekerjaan untuk state yang belum resmi. Jika enqueue gagal setelah commit, periodic sweep tetap menemukan row `queued`.

Baca:

- `apps/web/src/app/api/runs/[id]/start/route.ts`
- `apps/web/src/lib/server/run-actions.ts` — `startRun`
- `apps/web/src/lib/server/redis.ts`

## Dari queued sampai running

```text
BullMQ atau sweep membangunkan worker
  → dispatch mengambil advisory lock
  → scheduler mencari slot
  → worker preflight
  → seed test data
  → executor.create
  → queued → starting
  → reconciliation melihat runner aktif
  → starting → running
```

`queued` berarti load belum tentu dikirim. `starting` berarti workload sudah dibuat tetapi runner belum dikonfirmasi berjalan. `running` berarti executor menunjukkan workload aktif.

## Flow Stop

### Saat queued

Tidak ada workload. Status kembali ke `approved`, audit ditulis, dan run dapat dimulai lagi.

### Saat active

```text
Klik Stop
  → status stopping + audit
  → worker dibangunkan
  → executor resource dihapus
  → lease menjawab stop
  → runner berhenti
  → finishRun menyimpan aborted + emergency_stop
```

Baca:

- `apps/web/src/lib/server/run-actions.ts` — `stopRun`
- `apps/worker/src/reconcile.ts` — `stopRun`
- `packages/k6-lib/src/lease.ts`

## Flow Finish

```text
Executor terminal atau callback runner
  → finishRun
  → query summary Prometheus
  → cek generator evidence
  → cek target integrity
  → tentukan verdict dan caveats
  → cleanup test data
  → upload artifacts
  → transaction:
      status terminal
      run summary
      audit/timeline
  → hapus resource
  → dispatch queued run berikutnya
```

Baca:

- `apps/worker/src/finish.ts`
- `apps/worker/src/summary.ts`
- `apps/worker/src/integrity.ts`
- `apps/worker/src/artifacts.ts`

## Latihan

Buat smoke run local lalu catat tabel berikut:

| Tahap | Status DB | BullMQ | Executor | UI |
| --- | --- | --- | --- | --- |
| Setelah Create | | | | |
| Setelah Start | | | | |
| Setelah worker dispatch | | | | |
| Saat load berjalan | | | | |
| Setelah selesai | | | | |

## Checkpoint

1. Mengapa manifest immutable?
2. Mengapa approval terikat ke hash?
3. Apa beda queued, starting, dan running?
4. Apa yang membuat run completed tetapi verdict fail?
5. Mengapa Start memeriksa policy lagi?
6. Bagaimana queued run pulih jika enqueue gagal?
7. Apa perbedaan Stop ketika queued dan ketika running?
