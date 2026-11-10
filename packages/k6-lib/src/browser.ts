import type { RunnerConfig } from "@btb/contracts";
import { browser, type Page } from "k6/browser";
import exec from "k6/execution";
import http from "k6/http";

import { CATCH_UNCAUGHT, consoleKind, ErrorLog, errorsName, ShotPlan } from "./evidence";
import { pathAllowed } from "./guard";
import { THROTTLE } from "./options";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Per browser VU.
const errors = new ErrorLog();
const shots = new ShotPlan();

/** visitPage bound to the run's config: what a journey's browser half gets. */
export type Visit = (step: string, path: string, act: (page: Page) => Promise<void>) => Promise<void>;

async function upload(c: RunnerConfig, artifactsUrl: string, name: string, body: string | ArrayBuffer, contentType: string) {
  const url = `${artifactsUrl}?runId=${encodeURIComponent(c.runId)}&name=${encodeURIComponent(name)}`;
  const res = await http.asyncRequest("POST", url, body, {
    headers: { "Content-Type": contentType, Authorization: `Bearer ${c.lease.token}` },
    tags: { name: "btb-artifact" },
    timeout: "10s",
    responseCallback: http.expectedStatuses(200),
  });
  if (res.status !== 200) console.warn(`artifact ${name} not stored: HTTP ${res.status} ${typeof res.body === "string" ? res.body.slice(0, 200) : ""}`);
}

/**
 * One browser step: a fresh page on the run's target, throttled to the run's network profile. The page's web
 * vitals are tagged with the step name, so the worker reads them per step. A path outside the allowlist throws.
 * Page errors and a few screenshots are uploaded after the page is closed, so they don't skew its vitals.
 */
export async function visitPage(c: RunnerConfig, step: string, path: string, act: (page: Page) => Promise<void>) {
  if (!c.browser) throw new Error("browser steps need a network profile");
  if (!pathAllowed(path, c.allowedPaths)) throw new Error(`blocked by allowlist: path ${path}`);
  const url = `${c.targetUrl}${path}`;
  const throttle = THROTTLE[c.browser.network];
  const vu = exec.vu.idInTest;
  let failure: unknown = null;
  let shot: { name: string; body: ArrayBuffer } | null = null;

  const context = await browser.newContext();
  await context.addInitScript(CATCH_UNCAUGHT);
  const page = await context.newPage();
  try {
    page.on("metric", (m) => m.tag({ name: step, matches: [{ url: new RegExp(`^${escapeRe(url)}$`) }] }));
    page.on("console", (m) => {
      const e = consoleKind(m.type(), m.text());
      if (e) errors.add(step, e.kind, e.text, Date.now());
    });
    if (throttle) {
      await page.throttleNetwork({ latency: throttle.latency, download: throttle.download, upload: throttle.upload });
      await page.throttleCPU({ rate: throttle.cpuRate });
    }
    try {
      await page.goto(url, { waitUntil: "load" });
      await act(page);
    } catch (e) {
      failure = e;
      errors.add(step, "step", messageOf(e), Date.now());
    }
    const name = shots.next(step, vu, failure !== null);
    if (name) {
      // PNG: k6 2.3 ignores `type: "jpeg"` and always returns PNG bytes.
      const body = await page.screenshot().catch(() => null);
      if (body) shot = { name, body };
    }
  } finally {
    // Closing only the context leaves the console handler pending and the VU never starts another iteration.
    await page.close();
    await context.close();
  }

  if (shot) await upload(c, c.browser.artifactsUrl, shot.name, shot.body, "image/png");
  if (errors.due(Date.now())) {
    await upload(c, c.browser.artifactsUrl, errorsName(vu), JSON.stringify(errors.take(c.runId, vu, Date.now())), "application/json");
  }
  if (failure !== null) throw failure;
}
