import "server-only";

import { DEV_ACCOUNTS } from "@btb/core/dev-accounts";

import { findUserByEmail, listPeople } from "@/lib/server/users";

/*
 * MOCK sign-in until Entra ID app registrations exist (needs DevOps/IT) and UI-02 swaps in Auth.js.
 * Picking an account stands for "Microsoft says this is <email>"; the users table decides the rest,
 * exactly as it will with Entra. Only enabled outside production unless AUTH_MODE=mock (see config.ts).
 */

export const SSO_FAILURE = "sso-failure";
export const DEFAULT_MOCK_ACCOUNT = DEV_ACCOUNTS[0].email;

export interface SignInChoice {
  value: string;
  label: string;
  description: string;
}

/** The development picker: the seeded accounts, anyone added in Admin, and a failing sign-in. */
export async function signInChoices(): Promise<SignInChoice[]> {
  const known = new Set(DEV_ACCOUNTS.map((a) => a.email.toLowerCase()));
  const added = (await listPeople()).filter((u) => !known.has(u.email.toLowerCase()));
  return [
    ...DEV_ACCOUNTS.filter((a) => !a.failsSso).map((a) => ({ value: a.email, label: a.name, description: a.hint })),
    ...added.map((u) => ({ value: u.email, label: u.name, description: "Added in Admin" })),
    { value: SSO_FAILURE, label: "Sign-in failure", description: "Microsoft sign-in fails" },
  ];
}

export type MockSignIn = { ok: true; userId: string } | { ok: false; error: "sso_failed" | "no_access" };

/** What signing in as `value` gives: a user id for the session cookie, or the login error. */
export async function resolveMockSignIn(value: unknown): Promise<MockSignIn> {
  if (typeof value !== "string" || !value.includes("@")) return { ok: false, error: "sso_failed" };
  const user = await findUserByEmail(value);
  if (!user?.role) return { ok: false, error: "no_access" };
  return { ok: true, userId: user.id };
}
