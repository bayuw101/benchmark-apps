/*
 * Integrity adapter (PRD E9.3): read-only reconciliation of orders, seats, payments and tickets for one run's
 * window. One adapter per kind of data source; a target without one gets the "integrity not verified" caveat.
 */

export interface IntegrityCounts {
  oversoldSeats: number;
  doubleCharges: number;
  chargedNoTicket: number;
}

export interface IntegrityWindow {
  from: Date;
  to: Date;
}

export interface IntegrityAdapter {
  /** Where the numbers come from, for the timeline (e.g. "mock-target.targets.svc/__admin/integrity"). */
  readonly source: string;
  check(window: IntegrityWindow): Promise<IntegrityCounts>;
}

/** Path on the target host, with the window as `since`/`until` epoch ms. */
export function integrityRequestPath(path: string, w: IntegrityWindow) {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}since=${w.from.getTime()}&until=${w.to.getTime()}`;
}

/** The HTTP adapter's answer: `{ oversold, doubleCharges, chargedNoTicket }`, each a whole number ≥ 0. Throws otherwise. */
export function integrityCountsOf(body: unknown): IntegrityCounts {
  const b = (body ?? {}) as Record<string, unknown>;
  const count = (k: string) => {
    const n = b[k];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) throw new Error(`integrity answer: "${k}" is not a count`);
    return n;
  };
  return { oversoldSeats: count("oversold"), doubleCharges: count("doubleCharges"), chargedNoTicket: count("chargedNoTicket") };
}

export const integrityClean = (c: IntegrityCounts) => c.oversoldSeats === 0 && c.doubleCharges === 0 && c.chargedNoTicket === 0;

/**
 * An admin-set path: absolute, no scheme or host (it always goes to the target's first host), no spaces, and no
 * `.`/`..` segments: URL parsing resolves them, which would walk out of the API server's service proxy path.
 */
export const INTEGRITY_PATH_RE = /^(?!.*(?:^|\/)\.\.?(?:[/?]|$))\/(?!\/)[A-Za-z0-9._~\-/]*(\?[A-Za-z0-9._~\-=&]*)?$/;
