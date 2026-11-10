// Shared by middleware (edge) and the server: keep this file free of Node/Next server imports.
export const SESSION_COOKIE = "btb-session";
export const DEFAULT_AFTER_LOGIN = "/runs";

/**
 * Where to go after signing in. Only same-site absolute paths are allowed, so a crafted
 * `?next=https://evil.example` or `//evil.example` can't turn the login page into an open redirect.
 */
export function safeNext(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return DEFAULT_AFTER_LOGIN;
  if (raw === "/login" || raw.startsWith("/login?") || raw.startsWith("/login/")) return DEFAULT_AFTER_LOGIN;
  return raw;
}
