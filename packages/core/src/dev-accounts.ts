import type { Role } from "@btb/contracts";

/*
 * Development sign-in identities, standing in for Microsoft Entra ID until the app registration exists.
 * The web app's mock SSO offers these; `db:seed` gives each one a users row with the role below.
 * Roles live in the users table (PRD E1.3), so Admin can change them; these are only the starting point.
 */
export interface DevAccount {
  /** Stable picker key (not the user id). */
  key: string;
  name: string;
  email: string;
  role: Role | null;
  /** Simulates Microsoft sign-in failing (cancelled, tenant error, network). Never seeded. */
  failsSso?: boolean;
  hint: string;
}

export const DEV_ACCOUNTS: DevAccount[] = [
  { key: "bayu", name: "Bayu Wicaksono", email: "bayu.wicaksono@arbitersports.com", role: "admin", hint: "Admin" },
  { key: "engineer", name: "Test Engineer", email: "engineer@example.com", role: "engineer", hint: "Engineer: create and start runs" },
  { key: "approver", name: "Test Approver", email: "approver@example.com", role: "approver", hint: "Approver: review runs" },
  { key: "approver-2", name: "Second Approver", email: "approver2@example.com", role: "approver", hint: "Approver: prod-like needs two" },
  { key: "viewer", name: "Test Viewer", email: "viewer@example.com", role: "viewer", hint: "Viewer: read only" },
  { key: "no-role", name: "New Starter", email: "new.starter@example.com", role: null, hint: "Signed in, but no role yet" },
  { key: "sso-failure", name: "Sign-in failure", email: "", role: null, failsSso: true, hint: "Microsoft sign-in fails" },
];
