"use client";

import * as React from "react";
import { createPortal } from "react-dom";

interface ShellAsideValue {
  /** The slot to the right of the content card (same place as the AI panel). */
  container: HTMLElement | null;
  setOpen: (open: boolean) => void;
}

export const ShellAsideContext = React.createContext<ShellAsideValue | null>(null);

/**
 * Puts page content in the AppShell's right-hand slot, outside the content card, and makes the shell
 * push the card left (like the AI panel). The slot shows from `xl` (1280px); below that, render the
 * same content inline in the page instead. Outside an AppShell it renders nothing.
 */
export function ShellAside({ children }: { children: React.ReactNode }) {
  const ctx = React.useContext(ShellAsideContext);
  const setOpen = ctx?.setOpen;
  // Portal only after mount: the server renders nothing here, and a page inside a Suspense boundary can
  // hydrate after the shell has already registered its slot. A portal during hydration is a mismatch.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
    setOpen?.(true);
    return () => setOpen?.(false);
  }, [setOpen]);
  return mounted && ctx?.container ? createPortal(children, ctx.container) : null;
}
