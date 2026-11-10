"use client";

import { useSyncExternalStore } from "react";

/** The shell's phone layout: below Tailwind `md` (768px), the same breakpoint the AppShell uses. */
export const PHONE_QUERY = "(max-width: 767px)";

/** Live media-query match. False on the server; overlays that depend on it only render once opened on the client. */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const m = matchMedia(query);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    () => matchMedia(query).matches,
    () => false,
  );
}
