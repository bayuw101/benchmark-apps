import type { BrowserError, BrowserErrorsFile } from "@btb/contracts";

/*
 * What a browser VU keeps as evidence (E5.7): distinct page errors and a few screenshots per step.
 * Pure (no k6 imports), so it is unit-tested in Node.
 */

/** PROPOSAL: distinct errors kept per VU; more only count as `dropped`. */
export const MAX_ERRORS = 100;
const TEXT_MAX = 500;
/** Count-only changes are re-uploaded at most this often; a new distinct error goes up at once. */
export const ERRORS_EVERY_MS = 10_000;
/** PROPOSAL: one screenshot of each step's first success, and of its first few failures, per VU. */
export const FAIL_SHOTS_PER_STEP = 3;

/** Page errors reach k6 only through the console, so the init script re-logs uncaught ones with this prefix. */
export const UNCAUGHT_PREFIX = "[uncaught] ";
export const CATCH_UNCAUGHT = `(() => {
  const log = (e) => console.error(${JSON.stringify(UNCAUGHT_PREFIX)} + String((e && e.message) || e));
  addEventListener("error", (e) => log(e.error || e.message));
  addEventListener("unhandledrejection", (e) => log(e.reason));
})();`;

export const stepSlug = (step: string) =>
  step
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "step";

export const screenshotName = (step: string, vu: number, fail: number | null) =>
  `screenshot-${stepSlug(step)}-vu${vu}-${fail === null ? "ok" : `fail${fail}`}.png`;
export const errorsName = (vu: number) => `browser-errors-vu${vu}.json`;

/** A console message as a BrowserError kind, or null for anything below error level. */
export function consoleKind(type: string, text: string): { kind: BrowserError["kind"]; text: string } | null {
  if (type !== "error") return null;
  return text.startsWith(UNCAUGHT_PREFIX) ? { kind: "page", text: text.slice(UNCAUGHT_PREFIX.length) } : { kind: "console", text };
}

export class ErrorLog {
  private readonly byKey = new Map<string, BrowserError>();
  private dropped = 0;
  private changed = false;
  private fresh = false;
  private sentMs = 0;

  add(step: string, kind: BrowserError["kind"], text: string, nowMs: number) {
    const t = text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX)}…` : text;
    const key = `${step}\u0000${kind}\u0000${t}`;
    const at = new Date(nowMs).toISOString();
    const e = this.byKey.get(key);
    if (e) {
      e.count++;
      e.lastAt = at;
    } else if (this.byKey.size < MAX_ERRORS) {
      this.byKey.set(key, { step, kind, text: t, count: 1, firstAt: at, lastAt: at });
      this.fresh = true;
    } else {
      this.dropped++;
    }
    this.changed = true;
  }

  /** Worth an upload now: a new distinct error, or changed counts and the last upload is old enough. */
  due(nowMs: number) {
    return this.fresh || (this.changed && nowMs - this.sentMs >= ERRORS_EVERY_MS);
  }

  /** The file to upload; marks the log as sent. */
  take(runId: string, vu: number, nowMs: number): BrowserErrorsFile {
    this.fresh = this.changed = false;
    this.sentMs = nowMs;
    return { runId, vu, updatedAt: new Date(nowMs).toISOString(), errors: [...this.byKey.values()], dropped: this.dropped };
  }
}

export class ShotPlan {
  private readonly ok = new Set<string>();
  private readonly fails = new Map<string, number>();

  /** The screenshot to take after a visit (its file name), or null when this step has enough. */
  next(step: string, vu: number, failed: boolean): string | null {
    if (!failed) {
      if (this.ok.has(step)) return null;
      this.ok.add(step);
      return screenshotName(step, vu, null);
    }
    const n = (this.fails.get(step) ?? 0) + 1;
    if (n > FAIL_SHOTS_PER_STEP) return null;
    this.fails.set(step, n);
    return screenshotName(step, vu, n);
  }
}
