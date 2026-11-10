import { describe, expect, it } from "vitest";
import { DEV_ACCOUNTS } from "@btb/core/dev-accounts";

import { toSessionUser } from "@/lib/server/users";
import type { Role } from "@/lib/session";
import { DEFAULT_AFTER_LOGIN, safeNext } from "./constants";
import { signSession, verifySession } from "./session-cookie";

describe("safeNext", () => {
  it("keeps same-site paths, with their query", () => {
    expect(safeNext("/runs")).toBe("/runs");
    expect(safeNext("/runs?status=failed")).toBe("/runs?status=failed");
  });
  it("blocks open redirects and junk", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "runs", "", null, undefined, 42])
      expect(safeNext(bad)).toBe(DEFAULT_AFTER_LOGIN);
  });
  it("never sends you back to the login page", () => {
    expect(safeNext("/login")).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNext("/login?error=sso_failed")).toBe(DEFAULT_AFTER_LOGIN);
  });
});

describe("mock accounts", () => {
  const row = (role: Role | null) => ({ id: "u1", entraOid: null, email: "a@example.com", name: "A", role, createdAt: new Date(), updatedAt: new Date() });

  it("only users with a role get a session", () => {
    expect(toSessionUser(row("admin"))?.role).toBe("admin");
    expect(toSessionUser(row(null))).toBeNull();
    expect(toSessionUser(undefined)).toBeNull();
  });
  it("covers every role for testing guards", () => {
    const roles = new Set(DEV_ACCOUNTS.map((a) => a.role));
    for (const r of ["admin", "engineer", "approver", "viewer", null]) expect(roles.has(r as never)).toBe(true);
  });
});

describe("session cookie", () => {
  const id = "0b7e4c2a-1f3d-4e5a-9b8c-7d6e5f4a3b2c";

  it("round-trips a signed user id", () => {
    expect(verifySession(signSession(id))).toBe(id);
  });
  it("refuses a bare, tampered or foreign cookie", () => {
    const signed = signSession(id);
    expect(verifySession(id)).toBeNull();
    expect(verifySession(undefined)).toBeNull();
    expect(verifySession(`${id.replace("0", "1")}${signed.slice(id.length)}`)).toBeNull();
    expect(verifySession(`${id}.${"A".repeat(43)}`)).toBeNull();
  });
});
