# M5.4: SSE on a long run, Next.js standalone (PRD E0.8)

Date: 2026-11-08. The web app built as the production image (`apps/web/Dockerfile`, `NEXT_STANDALONE=1`,
`node apps/web/server.js`), run on port 3002 against the same Postgres and Redis. Run RUN-0185: Checkout v7, soak on
target `sse-mock` (16 VUs), emergency-stopped after 65 minutes. `sse_watch.py` held one connection to
`/api/runs/RUN-0185/live` the whole time and logged every event (`sse-RUN-0185.log`).

| | |
| --- | --- |
| Connection | one, 3,907 s, never reconnected |
| Events | 1 `snapshot`, 781 `tick`, 1 `end` |
| Gap between ticks | max 5.0 s, mean 4.99 s, none over 6 s |
| End | stop requested at 3,902 s → `tick` with `status=aborted` → `end` 5 s later |
| Server log | no errors or warnings |

Conclusion: the SSE endpoint stays stable for over an hour on the standalone server; ticks every 5 s keep the
connection busy, so there is no idle period for a proxy to time out. **Not covered here**: an ingress or load
balancer in front (AWS ALB idle timeout defaults to 60 s; with a tick every 5 s it shouldn't trigger, but check it
on the real ingress).

The other E0.8 points:
- k6 REST API for clean stops: not used. Decided 2026-11-08 (option B): stops go through the lease (runner aborts
  itself) or by deleting the TestRun; both proven in failsafe.md.
- Fluent Bit under saturation: not applicable yet, there is no log aggregation in the stack (`logsUrl` null). Runner
  logs are collected per run as artifacts instead.
- Staging DB access for integrity: not available (TBD-13). Integrity runs against the mock's read-only endpoint (M3).

Build fixes found on the way (the standalone image didn't build): `apps/web/vitest.config.ts` imported `vite`, which
isn't a direct dependency (works locally only through a stray `node_modules/vite`), and
`apps/web/src/lib/server/artifacts.ts` read `S3_BUCKET` at import, which `next build` does without runtime env. Both
fixed; the image builds.
