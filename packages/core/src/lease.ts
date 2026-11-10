import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * The runner's token for one run (E5.3, E6.1): `<expiry unix s>.<hex HMAC-SHA256(secret, "<run id>.<expiry>")>`.
 * The worker hands it out; the lease, manifest, artifact and callback endpoints check it.
 */

const TOKEN_RE = /^(\d{1,12})\.([0-9a-f]{64})$/;

const hmac = (key: string, data: string) => createHmac("sha256", key).update(data).digest("hex");

function sameText(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const leaseToken = (secret: string, runId: string, expiresAtSec: number) => `${expiresAtSec}.${hmac(secret, `${runId}.${expiresAtSec}`)}`;

export function leaseTokenValid(secret: string, runId: string, token: string, nowMs = Date.now()) {
  const m = TOKEN_RE.exec(token);
  if (!m || Number(m[1]) * 1000 <= nowMs) return false;
  return sameText(m[2], hmac(secret, `${runId}.${m[1]}`));
}

/** Signature of a runner callback body, keyed with the run's token. */
export const signBody = (token: string, body: string) => hmac(token, body);

export const signatureValid = (token: string, body: string, signature: string) => sameText(signature, signBody(token, body));
