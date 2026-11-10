# Modul 06: Peta Fitur

Dokumen ini menunjukkan entry point setiap fitur dan flow utamanya. Gunakan sebagai peta ketika menerima task baru.

## Login dan session

```text
/login
  → login action
  → session cookie
  → middleware filter awal
  → app layout memvalidasi session dan role
```

Baca:

- `apps/web/src/app/login/`
- `apps/web/src/lib/auth/`
- `apps/web/src/middleware.ts`
- `apps/web/src/app/(app)/layout.tsx`

Local memakai mock accounts. Entra ID masih external integration.

## Project switching

```text
ProjectSwitcher
  → project cookie/context berubah
  → list/detail direfresh atau kembali ke section root
  → server query memakai project ID aktif
```

Baca:

- `apps/web/src/components/project-provider.tsx`
- `apps/web/src/components/btb/project-switcher.tsx`
- `apps/web/src/lib/server/projects.ts`
- `apps/web/src/components/app-frame.tsx`

Project adalah boundary data. API tetap memeriksa akses; client context bukan authorization.

## Runs list

```text
Runs page
  → useRuns infinite query
  → GET /api/runs
  → active runs + filtered history + facets
  → InProgressBand/Rail + RunHistory
```

Baca:

- `apps/web/src/components/runs/runs-view.tsx`
- `apps/web/src/components/runs/use-runs.ts`
- `apps/web/src/components/runs/in-progress-band.tsx`
- `apps/web/src/components/runs/run-history.tsx`
- `apps/web/src/lib/server/runs.ts`

## Create dan edit run

Baca:

- `apps/web/src/components/runs/create-run-form.tsx`
- `apps/web/src/app/(app)/runs/new/`
- parallel/intercepting route `runs/@sheet/`
- `apps/web/src/lib/server/run-actions.ts`

Desktop navigation dapat membuka form sebagai sheet melalui intercepting route, sementara direct URL tetap mempunyai full page.

## Run detail

```text
/runs/:id
  → server load initial detail
  → RunDetailView
  → action mutation + refresh/query update
```

Baca:

- `apps/web/src/app/(app)/runs/[id]/page.tsx`
- `apps/web/src/components/runs/run-detail-view.tsx`
- `apps/web/src/components/runs/live-run.tsx`
- `apps/web/src/components/runs/run-results.tsx`

Detail menyesuaikan action berdasarkan status, role, dan preflight.

## Approvals

```text
Approvals page
  → inbox dari server
  → pilih run
  → review exact manifest/hash
  → approve atau reject
  → audit + state update
```

Baca:

- `apps/web/src/app/(app)/approvals/page.tsx`
- `apps/web/src/components/approvals/`
- `apps/web/src/lib/server/approvals.ts`
- approve/reject API routes.

## Scenario catalog

```text
Runner image catalog
  → catalog sync ke database
  → scenario list/detail
  → save perubahan sebagai version baru
```

Baca:

- `journeys/src/catalog.ts`
- `packages/core/src/catalog.ts`
- `packages/core/src/scripts/catalog-sync.ts`
- `apps/web/src/components/catalog/`
- `apps/web/src/lib/server/scenarios.ts`

Scenario version immutable. Edit menghasilkan version baru agar hasil antar-run tetap comparable.

## Admin

Admin mengelola:

- Projects.
- People dan role.
- Targets dan allowlist.
- Environment ceilings.
- Test-data pools.

Baca:

- `apps/web/src/components/admin/admin-view.tsx`
- `apps/web/src/components/admin/admin-sheets.tsx`
- `apps/web/src/lib/admin/validate.ts`
- `apps/web/src/lib/server/admin.ts`
- `apps/web/src/lib/server/admin-data.ts`
- `apps/web/src/app/api/admin/`

Setiap mutation memakai server validation, role admin, transaction, audit, loading state, dan toast.

## Emergency stop

```text
Stop button
  → confirmation
  → POST stop
  → DB stopping + audit
  → worker wake-up
  → executor delete + lease stop
  → final aborted result
```

Baca:

- stop UI di `run-detail-view.tsx` dan `live-run.tsx`.
- stop route.
- `run-actions.ts`.
- `reconcile.ts`.

## Baseline dan release trend

Baseline menunjuk satu completed run sebagai pembanding. Release trend mengambil completed run terakhir per release untuk scenario, target, dan preset sejenis.

Baca:

- baseline API route.
- baseline logic di server run actions/results.
- `run-results.tsx`.

## Report dan artifact

Report adalah HTML self-contained. Artifact disimpan di MinIO dan diakses melalui route yang memeriksa permission run.

Baca:

- report route.
- artifact routes.
- `artifact-viewer.tsx`.
- `apps/worker/src/artifacts.ts`.

## Cara memakai peta ini

Ketika mendapat bug atau feature request:

1. Tentukan fitur di atas.
2. Mulai dari component yang dilihat user.
3. Ikuti request ke route.
4. Temukan server/domain function.
5. Periksa storage dan async continuation.
6. Periksa feedback dan recovery path.

Jangan mulai dari grep acak seluruh repository jika entry point UI sudah diketahui.
