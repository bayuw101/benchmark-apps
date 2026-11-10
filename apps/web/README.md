# BTB web (Tailwind + shadcn)

Next.js 15 app for the Performance Audit Platform UI, styled to the **Arbiter Benchmark UI** design system
(https://claude.ai/artifact/T35xtMeBuGZfyY4ohohNPR). Screen plan: `../../docs/product/ui-epics.md`.

Set up the local stack first (database, dev data, worker): see the root [`README.md`](../../README.md#quick-start).

```sh
pnpm dev:up        # from the repo root, first time: everything, then the web app on http://localhost:3001
pnpm dev           # the web app alone, once the rest is up  (/gallery = every component)
pnpm --filter @btb/web check   # typecheck + lint + unit tests
pnpm --filter @btb/web build   # writes .next; `next dev` writes .next-dev, so both can run at once
```

## Layers (imports only go downward)

| Layer | Path | What lives there |
|---|---|---|
| App | `src/app/**`, `src/components/app-frame.tsx`, `src/components/<feature>/` (e.g. `runs/`) | Routes, route handlers (`app/api/**`), the shell wiring, page-level feature components |
| Gallery | `src/components/gallery/*` | Demo sections for `/gallery` only — never imported by product code |
| BTB | `src/components/btb/*` | Platform-specific pieces: run status, hash, verdict, policy violations, preflight, emergency stop, live chart |
| Arbiter | `src/components/arbiter/*` | The design system's own components on top of shadcn, one component per file (`app-shell`, `input-field`, `date-picker`, `confirm-dialog`, …) |
| ui | `src/components/ui/*` | shadcn/Radix primitives, restyled to the tokens. Only what Arbiter needs — do not add stock primitives that duplicate an Arbiter component |
| lib | `src/lib/*` | Pure helpers (`cn`, time, run status) and hooks. Unit-tested |

## Rules that are easy to break

- **Colours** come from `src/app/globals.css` only: hex tokens on `:root` / `[data-theme="dark"]`, exposed to Tailwind via `@theme`. No hex in components, no OKLCH.
- **Dark mode** is `data-theme="dark"` on `<html>`, set before paint by the inline script in `src/app/layout.tsx`; `useTheme()` toggles it. Not `next-themes`, not `.dark`.
- **Fields** are `InputField`, `SelectField`, `TextareaField` and the pickers from `components/arbiter` (floating label, 44px, no native validation). There is deliberately no `ui/input.tsx`.
- **Radius names differ**: Tailwind `rounded-md` = 6px (DS `radius-sm`), `rounded-lg` = 8px (DS `radius-md`), `rounded-xl` = 12px (DS `radius-lg`).
- **`text-secondary-foreground`** is whisper text (below AA). Never for anything a person must read.
- **Overlays**: `Modal` and `ConfirmDialog` cover the viewport; `RightPullSheet` covers the content card (via `ContentCardContext`). `contained` overrides either.
- **Toasts**: `notify.*` from `components/arbiter/toast`; `<Toaster/>` is mounted once in the root layout.
- Sidebar labels are one word, ≤ 8 characters (`Reviews`, `Catalog`).
- **Logo + name** always uses `BrandLockup` (`components/arbiter/brand-lockup.tsx`): the name is bottom-aligned, its baseline on the mark's visible bottom edge, with all spare height above it. Never vertically centre it. The mark alone (sidebar, mobile header) stays a plain image.
- **Auth**: `src/middleware.ts` sends visitors without a session cookie to `/login?next=…`; `app/(app)/layout.tsx` validates the cookie (`getSession()`) and is `force-dynamic`, so no page behind sign-in is ever prerendered. `next` is sanitised by `safeNext()` (no open redirects). Signing out also clears the active project.
- **Data**: pages fetch from route handlers under `app/api/**` with TanStack Query (PRD A4); list filters live in the URL. Route handlers read and write Postgres through `lib/server/*` (Drizzle client in `src/db`, schema in `packages/core`). In development `?simulate=error|forbidden|empty|idle|slow` shows the page states. Middleware never redirects `/api/*`: handlers answer 401/403 as JSON.
- **Every click shows feedback at once**: a navigation runs the top progress bar (`components/navigation.tsx`). Link clicks are caught automatically; call `useNavigate()` instead of `useRouter()` for push/replace/refresh/back and server actions, so the bar and your own `pending` last until the new page shows. Put `<LinkPending>` inside a `<Link>` (around its icon) for a spinner on the link itself, and give async buttons `loading`. Nothing clickable may look idle while work is under way.
- **Page width**: put page content in `<PageBody>` under `<PageShell>` (both in `components/arbiter/page-shell.tsx`). They share one column, so the header's title and actions line up with the content's edges. Never wrap content in your own padding or `max-w-*`. A full-bleed band uses `PAGE_WIDTH` for its inner row.
- **Create forms open in a sheet**: `/runs/new` always shows the Runs list with the Create run sheet open. From inside the app it's an intercepted route (`app/(app)/runs/@sheet/(.)new`) over the list already on screen. Loaded directly or refreshed, `runs/new/page.tsx` renders the list plus the same sheet, and closing replaces the URL with `/runs`. The sheet slot renders nothing on every other runs route, so navigating away closes it. Next's dev server needs a restart after adding a slot.
- **Side panel beside the card**: a page can put a panel in the shell's right-hand slot, outside the content card where the AI panel opens, with `<ShellAside>` (`components/arbiter/shell-aside.tsx`). It shows from `xl` (1280px) and pushes the card left. Below `xl`, render the same content inline (`xl:hidden`). The AI panel takes the slot when open. Runs uses it for In progress.
- **Active project** is the first breadcrumb item (`ProjectSwitcher` through the shell's `projectSwitcher` slot), kept in a session cookie `btb-project` and read in `app/(app)/layout.tsx`, so pages under it are server-rendered per request. Read it with `useProject()`. The cookie is a preference only: validate it (`resolveProjectId`) and check access on the server for every request.

## Database (Drizzle + Postgres)

Schema and migrations live in `packages/core` (`src/db/schema.ts`, `drizzle/*.sql`), shared with the worker; this app
only holds the client (`src/db/index.ts`). Migrations are generated by drizzle-kit, with two hand-written parts: the
run-id function and `PARTITION BY` in `0000_init.sql`, and everything in `0001_guards.sql`.

```sh
pnpm db:migrate                            # from the repo root; the ledger is drizzle.__drizzle_migrations
pnpm db:generate --name <change>           # after editing schema.ts; review the SQL before committing
pnpm db:generate --custom --name x         # an empty file for triggers, grants, data fixes
pnpm --filter @btb/core test               # includes the database guard tests (against the local stack)
```

Never `drizzle-kit push`: it diffs against the schema file and would rebuild `audit_logs` as a plain table.
What the database enforces, so the app doesn't have to: one starting/running/stopping run per target (partial
unique index), `audit_logs` and `scenario_versions` are append-only (trigger, for every role), the app role
`btb_app` has only SELECT + INSERT on `audit_logs`, and every row that history points at (targets, scenarios,
runs, users) is protected by plain FKs. Audit retention: `SELECT audit_logs_drop_before(now() - interval '1 year')`
(partitions exist through 2028-12; `audit_logs_add_month(date)` adds more).

## Known gaps

- **Sign-in is a mock** until Entra ID app registrations exist (DevOps/IT). `/login` shows a development-only account picker (every role, "no role", and a Microsoft failure). It is on in `pnpm dev`; a production build refuses every session unless `AUTH_MODE=mock` is set explicitly. Swapping in Auth.js touches `src/app/login/actions.ts` and `src/lib/auth/session.ts` only. Role checks in the UI are cosmetic — the server re-checks every action.
- The `-soft` status tokens have dark values in `globals.css` (tone mixed 16% into card) that the design system's `tokens.json` does not define yet; upstream them.
