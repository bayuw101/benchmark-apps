# Deep Dive Worker BTB

Subkursus ini membedah `apps/worker` secara runtut. Mulai dari process startup, ikuti satu run saat dijadwalkan, dijalankan, dipantau, dihentikan, lalu diselesaikan.

## Prasyarat

Selesaikan dahulu:

- [Orientasi](../00-orientation.md)
- [Lifecycle run](../02-run-lifecycle.md)
- [Worker dan queue](../03-worker-and-queue.md)

## Cara membaca

Setiap modul menjelaskan ulang istilah yang dipakainya sehingga dapat dibaca mandiri. [Kamus istilah](00-glossary.md) hanya reference tambahan jika kamu ingin mencari satu istilah dengan cepat. Jangan mulai dari `plan.ts` baris pertama sampai akhir. File itu berisi banyak pure helper untuk tahap yang berbeda. Ikuti urutan lifecycle:

```text
main
→ lock
→ dispatch
→ plan.schedule
→ preflight
→ executor
→ runner
→ reconcile + guards
→ live
→ finish + summary + integrity + artifacts
```

## Peta modul

| Modul | Fokus |
| --- | --- |
| [00](00-glossary.md) | Istilah dispatch, lease, reconciliation, guard, executor, outcome, verdict, dan lainnya |
| [01](01-startup-context-and-config.md) | Startup process, config, context, logging, timer, BullMQ |
| [02](02-lock-queue-and-dispatch.md) | Advisory lock, queue callback, dispatch pass, scheduler, preflight |
| [03](03-plan-and-executors.md) | Pure planning helpers, Kubernetes/Docker executor, Kubernetes client |
| [04](04-reconciliation-and-safety.md) | Reconciliation, stop, orphan cleanup, telemetry dan health guard |
| [05](05-live-metrics.md) | Prometheus client, live query, Redis sample, halaman Live Run |
| [06](06-finalization.md) | Summary, saturation, integrity, hooks, artifacts, terminal transaction |
| [07](07-file-and-function-catalog.md) | Katalog lengkap setiap file/function dan hubungan caller-callee |
| [08](08-trace-and-exercises.md) | Trace end-to-end, observasi runtime, dan latihan debugging |

## Aturan mental

Worker adalah coordinator, bukan load generator.

```text
Worker:
- memilih run
- memastikan aman
- membuat/menghapus workload
- membandingkan state
- membaca metrics
- menyimpan hasil

Runner k6:
- memverifikasi dirinya
- mengirim traffic
- menghasilkan metrics
- mengirim callback/evidence
```

## Halaman UI yang dipengaruhi worker

| Output worker | Halaman/component |
| --- | --- |
| `queuedBehind` dan status | `/runs`, `InProgressBand`, `RunHistory` |
| Preflight dan timeline | `/runs/:id`, `RunDetailView` |
| Live sample Redis | `/runs/:id`, `LiveRun`; juga In Progress cards |
| Terminal status, verdict, caveat | `/runs`, `/runs/:id`, `RunResults` |
| Summary dan journey metrics | `/runs/:id`, report HTML |
| Artifacts | `/runs/:id`, `ArtifactViewer` |
| Approval/status transitions | `/approvals`, review count, run detail |

Worker tidak merender halaman. Ia menghasilkan state dan evidence yang dibaca web.
