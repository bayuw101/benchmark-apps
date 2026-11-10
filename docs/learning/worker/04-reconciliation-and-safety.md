# 04: Reconciliation, Stop, dan Safety Guard

## Istilah yang dipakai di modul ini

- **Reconciliation** — proses membandingkan state resmi PostgreSQL dengan keadaan workload sebenarnya, lalu menyelaraskannya.
- **Guard** — safety check yang berjalan selama run, berbeda dari preflight yang berjalan sebelum start.
- **Telemetry** — metrics/sinyal observability yang membuktikan runner masih terlihat dan dapat diawasi.
- **Fail closed** — jika sinyal safety penting hilang, sistem berhenti daripada melanjutkan tanpa pengawasan.
- **Orphan** — workload milik BTB yang tidak lagi mempunyai active run row yang sesuai.
- **Callback** — pesan bertanda tangan dari runner tentang verified, refused, stopped, atau finished.
- **Terminal state** — state akhir yang tidak melanjutkan execution: completed, failed, aborted, atau rejected.
- **Grace period** — tambahan waktu terbatas sebelum timeout dianggap failure, untuk mengakomodasi startup/termination normal.

## `reconcile.ts`

Reconciliation menjawab:

> Database mengatakan apa, executor sebenarnya sedang apa, dan state apa yang seharusnya disimpan sekarang?

### `reconcile(ctx)`

1. Query semua active run (`starting`, `running`, `stopping`).
2. Untuk setiap run, pilih executor/scope.
3. Panggil `reconcileRun`.
4. Kumpulkan active IDs.
5. `sweepOrphans` untuk resource executor tanpa active DB row.
6. Return apakah ada run yang berakhir—agar caller segera dispatch slot baru.

### `reconcileRun(ctx, row)`

Mengambil executor status dan memutuskan:

- `starting` + workload running → `markRunning`.
- Terminal executor status → gabungkan callbacks/log lalu `finishRun`.
- `stopping` → delete resource dan finalisasi abort.
- Starting terlalu lama → failure.
- Running melewati duration + grace → abort/failure.
- Runner hilang → failure dengan alasan jelas.

### `runnerCallbacks(ctx, runId)`

Membaca audit callback events (`verified`, `refused`, `stopped`, `finished`) untuk menggabungkan sinyal executor dan runner.

### `refusedInLog(...)`

Fallback ketika callback tidak sampai. Membaca runner log untuk mendeteksi self-check refusal, misalnya platform tidak reachable.

### `markRunning(ctx, row, at)`

Conditional DB transition `starting → running`, menyimpan `startedAt`, dan menulis audit timeline.

### `stopRun(ctx, id)`

Worker-side stop:

1. Load run dan placement.
2. Pastikan status stopping/active sesuai.
3. Delete executor resource.
4. `finishRun` sebagai aborted dengan structured reason.

### `sweepOrphans(ctx, activeIds)`

Mencari resource milik BTB di executor yang tidak punya active DB row. Resource orphan dihapus agar tidak terus mengirim load atau memakai capacity.

## `guards.ts`

Safety guard berjalan saat live tick/state tick.

### `guardRunning(ctx, probeHealth)`

Query running runs, lalu per run:

1. `checkTelemetry` setiap tick.
2. `checkHealth` sesuai interval.
3. Jika outcome safety muncul, ubah state/finish run.
4. Return apakah ada abort agar dispatch dapat mencoba queued run lain.

### `checkTelemetry(ctx, id, startedAt)`

Query timestamp push k6 terakhir. Setelah startup grace, jika telemetry diam lebih dari `TELEMETRY_LOSS_SEC`, abort `telemetry_lost`.

Prinsipnya fail closed:

```text
Tidak ada telemetry
→ kita tidak tahu load masih aman
→ hentikan load
```

### `checkHealth(ctx, id, host, healthPath)`

Probe target health. Setelah beberapa kegagalan berturut-turut sesuai aturan, outcome `target_health` dibuat.

## Timeout penting

- `STARTING_TIMEOUT_SEC` — workload tidak boleh selamanya starting.
- `OVERRUN_GRACE_SEC` — run tidak boleh jauh melebihi planned duration.
- `HEALTH_PROBE_EVERY_SEC` — interval probe.
- `HEALTH_FAILS_TO_ABORT` — jumlah failure sebelum abort.
- `TELEMETRY_LOSS_SEC` — batas tidak ada metrics.

## Hubungan dengan UI

| Safety event | UI effect |
| --- | --- |
| mark running | Status badge dan live panel aktif |
| telemetry lost | Run aborted + reason di detail/history |
| target unhealthy | Run aborted + timeline reason |
| runner missing | Failed + system error context |
| emergency stop | Stopping lalu Aborted |
| orphan cleanup | Operasional; biasanya terlihat di log, bukan page khusus |

## Mengapa dua sinyal terminal?

BTB memakai:

1. Executor state (TestRun/pod/container).
2. Signed runner callback.

Satu sinyal dapat hilang. Reconciliation menggabungkan keduanya dan mencatat callback yang hilang. Run menjadi unknown hanya jika evidence benar-benar tidak cukup.

## Ringkasan pemahaman

1. **Apa beda reconciliation dan dispatch?** Dispatch melihat queued work dan mencoba membuat execution baru. Reconciliation melihat execution yang sudah active lalu menyelaraskan database dengan kenyataan executor: running, terminal, hilang, timeout, atau stopping.
2. **Mengapa `stopping` belum dianggap selesai?** Itu hanya business intent bahwa penghentian diminta. Sampai pod/container benar-benar terminal atau dihapus, load dan resource mungkin masih aktif.
3. **Mengapa telemetry loss harus abort?** Tanpa telemetry BTB tidak dapat melihat error, threshold, atau generator health. Safety rule memilih fail closed: lebih aman menghentikan load daripada menjalankannya dalam keadaan buta.
4. **Apa fungsi orphan sweep?** Menghapus TestRun/container milik BTB yang tidak mempunyai active DB row. Ini mencegah workload bocor setelah crash, state corruption, atau cleanup yang terlewat.
5. **Mengapa callback dan executor state digabung?** Executor mengetahui lifecycle pod/container, sedangkan signed callback mengetahui hasil self-check dan exit dari sudut runner. Salah satunya dapat hilang atau terlambat; gabungan memberi evidence lebih kuat dan memungkinkan missing signal dicatat.
6. **Bagaimana worker pulih setelah restart?** PostgreSQL menyimpan active state dan executor menyimpan workload nyata. Tick baru menjalankan reconciliation, membaca keduanya, lalu melanjutkan monitoring/finalization. Worker tidak bergantung pada memory process lama.
