"use client";

import * as React from "react";

/**
 * The AppShell's floating content card element. Overlays that belong to the page
 * (RightPullSheet, ConfirmDialog) portal into it so they cover only the card, not the shell.
 * null outside an AppShell: those overlays fall back to the viewport.
 */
export const ContentCardContext = React.createContext<HTMLElement | null>(null);

export function useContentCard() {
  return React.useContext(ContentCardContext);
}
