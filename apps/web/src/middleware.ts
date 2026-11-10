import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/lib/auth/constants";

/**
 * Cheap gate: no session cookie → the login page, remembering where you were going.
 * The cookie's *value* is validated on the server (app layout); this only avoids rendering
 * protected pages for visitors who obviously aren't signed in.
 */
export function middleware(request: NextRequest) {
  // API routes authenticate in every handler (PRD N10) and answer 401 as JSON; never redirect a fetch to HTML.
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.next();
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const url = request.nextUrl.clone();
  const next = request.nextUrl.pathname + request.nextUrl.search;
  url.pathname = "/login";
  url.search = next === "/" ? "" : `?next=${encodeURIComponent(next)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the login page, Next internals and public assets.
  matcher: ["/((?!login|_next/|icon\\.png|favicon\\.ico|.*\\.(?:png|svg|jpg|jpeg|webp|ico)$).*)"],
};
