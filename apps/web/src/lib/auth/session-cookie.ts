import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * The mock session cookie: `<user id>.<HMAC-SHA256>`, signed with AUTH_SECRET (the variable Auth.js uses too).
 * Without the signature anyone who learned a user id could set the cookie and act as that person.
 */

const DEV_SECRET = "btb-dev-only-session-secret";

function secret() {
  const s = process.env.AUTH_SECRET;
  if (s) return s;
  // Production with AUTH_MODE=mock (a shared demo) must set a real secret.
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET is not set");
  return DEV_SECRET;
}

const mac = (userId: string) => createHmac("sha256", secret()).update(userId).digest("base64url");

export function signSession(userId: string): string {
  return `${userId}.${mac(userId)}`;
}

/** The user id, or null when the cookie is missing, malformed or not signed with our secret. */
export function verifySession(value: string | undefined): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(mac(userId));
  return given.length === expected.length && timingSafeEqual(given, expected) ? userId : null;
}
