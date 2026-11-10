import type { JourneyContext, TargetClient, Visit } from "@btb/k6-lib";
import { check, group, sleep } from "k6";

import { meta } from "./meta";

const [LIST, OPEN] = meta.steps;
export const PAGE_STEP = "Event page";

function listEvents(target: TargetClient): string[] {
  const res = target.get("/events", { tags: { name: "GET /events" } });
  check(res, { "events 200": (r) => r.status === 200 });
  return res.status === 200 ? (res.json() as { id: string }[]).map((e) => e.id) : [];
}

const pick = (ids: string[]) => ids[Math.floor(Math.random() * ids.length)] ?? "";

function think(params: JourneyContext["params"]) {
  const sec = Number(params.thinkTimeSec);
  if (sec > 0) sleep(sec);
}

export function run({ http: target, params }: JourneyContext) {
  let eventId = params.eventId === "any" ? "" : String(params.eventId);

  group(LIST, () => {
    const ids = listEvents(target);
    if (!eventId) eventId = pick(ids);
  });

  if (eventId) {
    group(OPEN, () => {
      const res = target.get(`/events/${encodeURIComponent(eventId)}`, { tags: { name: "GET /events/:id" } });
      check(res, { "event 200": (r) => r.status === 200 });
    });
  }

  think(params);
}

/** Browser half: the event page as a fan's phone renders it, then a tap on "Choose seats" (gives INP). */
export async function page({ http: target, params }: JourneyContext, visit: Visit) {
  const eventId = params.eventId === "any" ? pick(listEvents(target)) : String(params.eventId);
  if (!eventId) return;
  await visit(PAGE_STEP, `/events/${encodeURIComponent(eventId)}/page`, async (p) => {
    await p.waitForFunction(`!document.querySelector("#seats").textContent.startsWith("Checking")`);
    check(await p.locator("#title").textContent(), { "event page shows the event": (t) => !!t?.startsWith("Event ") });
    await p.locator("#buy").click();
    await p.locator("#picked").waitFor();
  });
  think(params);
}
