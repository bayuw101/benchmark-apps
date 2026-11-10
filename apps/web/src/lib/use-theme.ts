"use client";

import { useEffect, useState } from "react";

import { THEME_KEY, parseTheme, type Theme } from "@/lib/theme";

export type { Theme };

/**
 * Theme lives on <html data-theme>; the layout's inline script sets it before first paint from
 * localStorage (default light). Every change is saved back to localStorage.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(parseTheme(document.documentElement.getAttribute("data-theme")));
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage blocked (private mode, disabled site data): the choice lasts for this page only.
    }
    setTheme(next);
  }

  return { theme, toggle };
}
