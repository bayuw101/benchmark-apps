# 03: Plan Helpers dan Executor

## Istilah yang dipakai di modul ini

- **Plan helper** — function perhitungan tanpa I/O untuk scheduling, resource, outcome, query, atau config runner.
- **Pure function** — function yang output-nya hanya ditentukan input dan tidak mengakses database/network; mudah diuji.
- **Executor** — interface untuk tempat workload dijalankan. Kubernetes dan Docker adalah implementasinya.
- **Workload** — resource nyata yang menjalankan k6: TestRun/pod atau Docker container.
- **TestRun** — Kubernetes Custom Resource milik k6 Operator; operator mengubahnya menjadi runner pods.
- **Parallelism** — jumlah runner pod/container yang membagi load satu run.
- **Outcome** — hasil teknis execution, misalnya completed, failed, atau aborted.
- **Verdict** — penilaian pass/fail terhadap threshold dan integrity; berbeda dari outcome.
- **Adapter** — penerjemah contract umum ke teknologi konkret, misalnya `KubernetesExecutor`.

## Mengapa `plan.ts` besar?

`plan.ts` berisi pure atau mostly-pure logic yang dipisahkan dari I/O. Ia tidak membuat database connection atau HTTP request. Ini membuat algoritma scheduling, resource calculation, query generation, dan outcome mapping mudah diuji.

## Kelompok function `plan.ts`

### Identitas dan scheduling

- `assertRunId` — validasi format RUN-ID sebelum digunakan untuk nama resource.
- `schedule` — alokasi slot target dan namespace.
- `testRunName` — mengubah run ID menjadi nama Kubernetes-safe.

### Parallelism dan resources

- `parallelismFor` — membagi load berdasarkan `LOAD_PER_RUNNER` dan max parallelism.
- `runnerResources` — memilih CPU/memory untuk protocol atau browser runner.
- `goMemLimit` — menetapkan Go heap sekitar 80% memory limit agar soak test tidak OOM.
- `capacityNeed` — menghitung resource yang dibutuhkan semua runner.
- `capacityShortfall` — membandingkan kebutuhan dengan ResourceQuota.
- `parseQuantity` — parse Kubernetes quantity seperti Mi/Gi/mCPU.

### Runner configuration dan manifest

- `tokenExpiry` — expiry short-lived runner token.
- `runnerConfig` — config yang diberikan ke runner: manifest context, lease, target, allowlist, test data.
- `runnerImage` — membentuk image reference.
- `testRunManifest` — membentuk Kubernetes TestRun object lengkap.
- `clusterService` — mengenali hostname Kubernetes Service untuk API proxy.

### Outcome dan callback

- `outcomeOf` — mapping exit codes pod ke terminal outcome.
- `withCallbacks` — menggabungkan executor exit dengan signed runner callbacks dan mendeteksi callback hilang.
- `selfCheckRefusal` — membaca refusal dari runner log jika callback tidak sampai.
- `runnerDied` — mendeteksi pod hilang/mati sebelum outcome normal.

### Verdict dan caveat

- `verdictOf` — pass/fail dari outcome, threshold, dan integrity.
- `caveatsOf` — measurement gap, saturation, atau integrity not verified.
- `saturationOf` — menentukan generator saturated dari CPU atau dropped iterations.

### Prometheus query builders

- `liveQueries`
- `lastPushQuery`
- `summaryQueries`
- `browserQueries`
- `journeyQueries`
- `saturationQueries`

Function ini menghasilkan PromQL yang konsisten dan selalu memfilter run ID.

### Summary transformation

- `gapSeconds`, `errorRate`
- `browserSteps`
- `journeySummary`
- `saturationNumbers`

### Executor adapters

- `kubeStatus` — ubah status TestRun/pod menjadi `ExecutionStatus` netral.
- `dockerRunArgs` — command aman untuk runner container.
- `dockerStatus` — ubah `docker ps` menjadi `ExecutionStatus`.

## Executor contract

`packages/core/src/executor.ts` mendefinisikan:

```text
capacity
create
status
delete
runners
logTail
owned
describe
```

Worker lifecycle hanya bergantung pada contract ini, bukan detail Kubernetes/Docker.

## `executors.ts`

### `KubernetesExecutor`

Adapter dari generic Executor ke `Kube`:

- `capacity` → namespace quota.
- `create` → create TestRun manifest.
- `status` → TestRun + runner pod status.
- `delete` → delete TestRun.
- `runners` → pod exit/status.
- `logTail` → pod logs.
- `owned` → list TestRun milik BTB.
- `describe` → diagnostic description.

### `DockerExecutor`

Menjalankan Docker CLI untuk local-only mode:

- Satu atau beberapa runner containers.
- Host/network config terbatas.
- Labels untuk run ID/scope.
- CPU/memory limit sama secara konseptual dengan pod.
- Tidak boleh production dan hanya loopback target.

## `kube.ts`

Low-level Kubernetes wrapper:

- `withTimeout` — batas waktu API call.
- `kubeErrorMessage` — pesan error yang lebih berguna.
- `Kube.create/read/delete TestRun`.
- List pod dan logs.
- Namespace ResourceQuota.
- Service proxy untuk health/integrity/hooks.
- `info` — parse raw custom resource menjadi `TestRunInfo`.

`kube.ts` tidak membuat keputusan bisnis; ia menerjemahkan operasi Kubernetes.

## Koneksi ke halaman

Executor tidak dipanggil UI langsung. Efeknya terlihat sebagai:

- `starting/running/stopping` pada `/runs`.
- Runner/pod detail dan timeline pada `/runs/:id`.
- Artifact log setelah selesai.
- Failure reason jika create/status/delete gagal.

## Ringkasan pemahaman

1. **Mengapa pure planning logic dipisah dari executor I/O?** Algoritma dapat diuji cepat dengan input/output deterministik tanpa cluster, Docker, network, atau database. I/O adapter boleh berubah tanpa mengubah aturan scheduling, resource, outcome, dan verdict.
2. **Apa manfaat interface `Executor`?** Dispatch, reconciliation, stop, logs, dan finalization memakai contract yang sama. Kubernetes dan Docker hanya implementasi. Worker lifecycle tidak dipenuhi conditional Kubernetes/Docker di setiap function.
3. **Mengapa `goMemLimit` dihitung dari pod memory limit?** Runtime Go k6 perlu menahan heap sebelum cgroup mencapai hard limit. Sekitar 80% memberi ruang untuk stack, native allocation, dan proses lain sehingga soak panjang tidak berakhir OOMKilled.
4. **Apa beda `outcomeOf`, `kubeStatus`, dan `verdictOf`?** `kubeStatus` menerjemahkan keadaan TestRun/pod menjadi status executor netral. `outcomeOf` menerjemahkan exit code runner menjadi terminal execution outcome. `verdictOf` menilai apakah hasil performance/integrity pass atau fail; run dapat completed tetapi verdict fail.
5. **Mengapa health probe Kubernetes Service memakai API proxy?** Worker container belum tentu dapat meresolve DNS/service network cluster secara langsung. Kubernetes API proxy memakai credential worker yang terbatas untuk mencapai Service secara konsisten tanpa membuka target ke host/public network.
