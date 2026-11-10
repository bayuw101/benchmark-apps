import { LIVE_INTERVAL_SEC, type LivePlan } from "@btb/contracts";

import { IN_FLIGHT } from "@/lib/runs/types";
import { getRun, readSamples } from "@/lib/server/runs";
import { withAuth } from "@/lib/server/with-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/runs/[id]/live — Server-Sent Events, one update every 5 s (PRD E8.2/E8.3).
 * `snapshot` first (every sample so far), then `tick` with new samples, then `end` when the run stops.
 * The worker's live loop is the only Prometheus reader: it appends a sample per run to Redis, and every
 * viewer reads that list (one loop per run, any number of viewers). The browser never sends PromQL.
 * Dev: `?simulate=delay` goes quiet after 2 ticks.
 */
export const GET = withAuth<{ id: string }>(async (request, { params }) => {
  const id = params.id;
  if (!(await getRun(id))) return new Response("not found", { status: 404 });
  const simulate = process.env.NODE_ENV !== "production" ? request.nextUrl.searchParams.get("simulate") : null;

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  let busy = false;
  let next = 0;
  let ticks = 0;

  const stream = new ReadableStream({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        try {
          controller.close();
        } catch {}
      };
      const push = (event: string, data: unknown) => {
        if (!closed) controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const send = async (first: boolean) => {
        if (busy || closed) return;
        busy = true;
        try {
          const run = await getRun(id);
          if (!run) return close();
          const { load, thresholds } = run.manifest;
          const plan: LivePlan = { model: load.model, load: load.target, rampSec: load.rampSec, durationSec: run.durationSec };
          const startedAt = run.startedAt ? Date.parse(run.startedAt) : null;
          const until = run.endedAt ? Date.parse(run.endedAt) : Date.now();
          const elapsedSec = startedAt ? Math.min(run.durationSec, Math.max(0, (until - startedAt) / 1000)) : 0;
          const samples = await readSamples(id, next);
          next += samples.length;
          push(first ? "snapshot" : "tick", {
            status: run.status,
            startedAt: run.startedAt ?? null,
            durationSec: run.durationSec,
            elapsedSec: Math.round(elapsedSec),
            plan,
            thresholds,
            samples,
          });
          if (!IN_FLIGHT.includes(run.status)) {
            push("end", { status: run.status, abortReason: run.abortReason ?? null });
            close();
          }
        } catch (e) {
          // Database or Redis hiccup: skip this tick; the page shows "Data delayed" if it lasts.
          console.error(`[live ${id}]`, e);
        } finally {
          busy = false;
        }
      };

      void send(true);
      timer = setInterval(() => {
        if (simulate === "delay" && ++ticks > 2) return; // connection stays open, data stops: the page shows "Data delayed"
        void send(false);
      }, LIVE_INTERVAL_SEC * 1000);
      request.signal.addEventListener("abort", close);
    },
    cancel() {
      closed = true;
      clearInterval(timer);
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}, { role: "viewer" });
