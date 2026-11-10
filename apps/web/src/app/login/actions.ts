"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { mockAuthEnabled } from "@/lib/auth/config";
import { DEFAULT_AFTER_LOGIN, SESSION_COOKIE, safeNext } from "@/lib/auth/constants";
import { DEFAULT_MOCK_ACCOUNT, resolveMockSignIn } from "@/lib/auth/mock-accounts";
import { signSession } from "@/lib/auth/session-cookie";
import { PROJECT_COOKIE } from "@/lib/projects";

/**
 * "Sign in with Microsoft". mock flow; with Entra ID this becomes Auth.js
 * `signIn("microsoft-entra-id", { redirectTo: next })` and the role lookup moves to its callbacks.
 */
export async function signIn(formData: FormData) {
  const next = safeNext(formData.get("next"));
  const back = (error: string) => redirect(`/login?error=${error}${next !== DEFAULT_AFTER_LOGIN ? `&next=${encodeURIComponent(next)}` : ""}`);

  if (!mockAuthEnabled) back("unavailable");
  // Microsoft may say yes with no Benchmark role: then no session (PRD E1: roles live in our DB).
  const result = await resolveMockSignIn(formData.get("account") ?? DEFAULT_MOCK_ACCOUNT);
  if (!result.ok) return back(result.error);

  (await cookies()).set(SESSION_COOKIE, signSession(result.userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  redirect(next);
}

/** Ends the session. The active project is per session too, so it goes as well. */
export async function signOut() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(PROJECT_COOKIE);
  redirect("/login?signed_out=1");
}
