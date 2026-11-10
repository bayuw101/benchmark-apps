"use client";

import * as React from "react";
import { House } from "lucide-react";

import { cn } from "@/lib/utils";
import { Hint } from "@/components/ui/tooltip";

/**
 * Breadcrumb that never overflows its slot: when the trail does not fit, the earliest sections
 * collapse one by one into a single "…" (full path in its tooltip), e.g. "… / RUN-0421 / Results".
 * Only when the current page alone is left does it truncate with an ellipsis.
 * `leading` is a pinned item after home (e.g. the project switcher): it never collapses.
 */
export function Breadcrumbs({ items, homeClassName, leading }: { items: string[]; homeClassName?: string; leading?: React.ReactNode }) {
  const ref = React.useRef<HTMLOListElement>(null);
  const [width, setWidth] = React.useState(0);
  const [hidden, setHidden] = React.useState(0);
  const signature = items.join("\u0000");

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // New width or new trail: start from the full trail again, then collapse until it fits.
  React.useLayoutEffect(() => setHidden(0), [width, signature]);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.scrollWidth > el.clientWidth && hidden < items.length - 1) setHidden((h) => h + 1);
  }, [hidden, width, signature, items.length]);

  const visible = items.slice(hidden);
  const collapsed = items.slice(0, hidden);
  const last = items.length - 1;

  return (
    <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
      <ol ref={ref} className="flex min-w-0 items-center gap-1.5 overflow-hidden text-xs">
        <li className={cn("flex shrink-0 items-center", homeClassName)}>
          <House className="size-3.5" aria-label="Home" />
        </li>
        {leading ? (
          <li className="flex min-w-0 shrink-0 items-center gap-1.5">
            <span aria-hidden className="text-shell-border">/</span>
            {leading}
          </li>
        ) : null}
        {collapsed.length > 0 ? (
          <li className="flex shrink-0 items-center gap-1.5">
            <span aria-hidden className="text-shell-border">/</span>
            <Hint label={collapsed.join(" / ")} side="bottom">
              <span aria-hidden>…</span>
            </Hint>
            <span className="sr-only">{collapsed.join(" / ")}</span>
          </li>
        ) : null}
        {visible.map((c, i) => {
          const index = hidden + i;
          const current = index === last;
          return (
            <li
              key={`${c}-${index}`}
              aria-current={current ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap",
                // Everything keeps its width while measuring; the current page may truncate only once nothing else can collapse.
                current && hidden === last ? "min-w-0" : "shrink-0",
                current && "font-medium text-shell-foreground",
              )}
            >
              <span aria-hidden className="shrink-0 text-shell-border">/</span>
              {current ? (
                <Hint label={c} side="bottom">
                  <span className={cn(hidden === last && "truncate")}>{c}</span>
                </Hint>
              ) : (
                <span>{c}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
