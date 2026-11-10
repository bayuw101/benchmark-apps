// Theme preference lives in localStorage under this key. Default is light; the system
// colour scheme is deliberately NOT consulted.
export const THEME_KEY = "theme";
export type Theme = "light" | "dark";
export const DEFAULT_THEME: Theme = "light";

/** Anything that is not exactly "dark" (missing, tampered, old values) means light. */
export function parseTheme(raw: string | null | undefined): Theme {
  return raw === "dark" ? "dark" : DEFAULT_THEME;
}
