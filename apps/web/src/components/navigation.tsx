"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

/*
 * Rule: every click shows feedback at once. Any navigation runs a thin bar along the top of the window:
 * link clicks are caught here, programmatic ones go through `useNavigate` (a transition, so its pending state
 * lasts until the new page is on screen). Buttons and links also show their own spinner (Button `loading`,
 * LinkPending).
 */

type Report = (id: symbol, pending: boolean) => void;
const NavigationContext = React.createContext<Report>(() => {});

function UrlWatcher({ onChange }: { onChange: () => void }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  React.useEffect(onChange, [pathname, search, onChange]);
  return null;
}

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const [sources, setSources] = React.useState<ReadonlySet<symbol>>(new Set());
  const [linkPending, setLinkPending] = React.useState(false);

  const report = React.useCallback<Report>((id, pending) => {
    setSources((prev) => {
      if (prev.has(id) === pending) return prev;
      const next = new Set(prev);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  // In-app link clicks: start at once; the URL changing (new page committed) ends it.
  React.useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement) || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
      if (url.pathname === location.pathname && url.search === location.search) return; // same page or a #hash
      setLinkPending(true);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  // Fail-safe: never spin forever (e.g. a navigation the router cancelled).
  React.useEffect(() => {
    if (!linkPending) return;
    const t = setTimeout(() => setLinkPending(false), 15_000);
    return () => clearTimeout(t);
  }, [linkPending]);
  const endLink = React.useCallback(() => setLinkPending(false), []);

  const busy = linkPending || sources.size > 0;
  return (
    <NavigationContext.Provider value={report}>
      <React.Suspense fallback={null}>
        <UrlWatcher onChange={endLink} />
      </React.Suspense>
      <div
        role="progressbar"
        aria-label="Loading page"
        aria-hidden={!busy}
        className={cn("pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden transition-opacity", busy ? "opacity-100 duration-0" : "opacity-0 duration-300")}
      >
        <div className="h-full w-1/3 animate-progress bg-brand motion-reduce:w-full motion-reduce:animate-none" />
      </div>
      {children}
    </NavigationContext.Provider>
  );
}

/** router.push/replace/refresh/back and server actions, with a `pending` that lasts until the new page shows. */
export function useNavigate() {
  const router = useRouter();
  const report = React.useContext(NavigationContext);
  const [pending, startTransition] = React.useTransition();
  const [id] = React.useState(() => Symbol("navigation"));
  React.useEffect(() => {
    report(id, pending);
    return () => report(id, false);
  }, [report, id, pending]);

  return React.useMemo(
    () => ({
      pending,
      push: (href: string, options?: { scroll?: boolean }) => startTransition(() => router.push(href, options)),
      replace: (href: string, options?: { scroll?: boolean }) => startTransition(() => router.replace(href, options)),
      refresh: () => startTransition(() => router.refresh()),
      back: () => startTransition(() => router.back()),
      /** Any async work that ends in a navigation (e.g. a sign-out server action). */
      run: (fn: () => Promise<unknown> | void) => startTransition(async () => void (await fn())),
    }),
    [pending, router],
  );
}
