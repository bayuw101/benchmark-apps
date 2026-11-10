// A project scopes everything in the app: runs, targets, scenarios, approvals.
// Per-project permissions are out of MVP scope (PRD): every signed-in user sees every project.
export interface Project {
  id: string;
  name: string;
  description?: string;
}

/**
 * The active project is a per-session preference: a session cookie (no expiry, gone when the
 * browser closes). It is NOT authority. The server must still check the user may access it.
 */
export const PROJECT_COOKIE = "btb-project";

/** "Fan ticketing app" → "fan-ticketing-app", unique among `taken`. */
export function projectSlug(name: string, taken: string[]) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "project";
  let id = base;
  for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`;
  return id;
}

/** The cookie value is untrusted input: anything that is not a known project falls back to the first. */
export function resolveProjectId(raw: string | undefined, projects: Project[]): string {
  return projects.find((p) => p.id === raw)?.id ?? projects[0]?.id ?? "";
}

/** "Fan ticketing" → "FT", "Arbiterlive" → "A". */
export function projectInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}
