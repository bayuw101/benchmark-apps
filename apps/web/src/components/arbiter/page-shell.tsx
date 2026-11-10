"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/arbiter/search-input";
import { LinkPending } from "@/components/arbiter/link-pending";
import { Hint } from "@/components/ui/tooltip";

/* PageShell: sticky per-page header, h-14, blur. The bar spans the card; its contents use PAGE_WIDTH, the
   same column as PageBody, so title and actions line up with the content's left and right edges. */

/** The page column: every page's content and header sit in it. Use PageBody (or this, for full-bleed bands). */
export const PAGE_WIDTH = "mx-auto w-full max-w-6xl px-5";

/** A page's content area under PageShell. Never wrap page content in your own padding or width. */
export function PageBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn(PAGE_WIDTH, "py-5", className)} {...props} />;
}

export interface PageShellProps {
  title: string;
  subtitle?: string;
  onSearch?: (q: string) => void;
  searchLabel?: string;
  /** Initial search text (e.g. from the URL). */
  searchDefaultValue?: string;
  /** Desktop primary action (h-8). */
  action?: React.ReactNode;
  /** Mobile icon button handler; required for the action to show on mobile. */
  onAction?: () => void;
  /** Mobile icon (default "+"), for actions that are not "add". */
  actionIcon?: React.ReactNode;
  /** Accessible name of the mobile icon button. */
  actionLabel?: string;
  /** The mobile icon button's spinner (its navigation or action is under way). */
  actionPending?: boolean;
  /** Detail pages: a back button before the title, as tall as title + subtitle. */
  backHref?: string;
  backLabel?: string;
  /** Beside the title, e.g. a status badge. */
  titleAside?: React.ReactNode;
  /** Actions shown at every width (the caller keeps them compact on phones). Use instead of `action`. */
  actions?: React.ReactNode;
}

export function PageShell({
  title, subtitle, onSearch, searchLabel = "Search", searchDefaultValue, action, onAction, actionIcon, actionLabel = "Add",
  backHref, backLabel = "Back", titleAside, actions, actionPending,
}: PageShellProps) {
  return (
    <div className="sticky top-0 z-20 border-b border-border bg-card/80 backdrop-blur-md">
      <div className={cn(PAGE_WIDTH, "flex h-14 items-center justify-between gap-3")}>
        <div className="flex min-w-0 items-center gap-3">
          {backHref ? (
            // size-9 = the title (20px) + subtitle (16px) lines beside it.
            <Hint label={backLabel} side="bottom">
              <Link
                href={backHref}
                aria-label={backLabel}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:shadow-focus"
              >
                <LinkPending>
                  <ChevronLeft className="size-4" />
                </LinkPending>
              </Link>
            </Hint>
          ) : null}
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-sm leading-5 font-semibold">{title}</h1>
              {titleAside}
            </div>
            {subtitle ? <div className="truncate text-xs leading-4 text-muted-foreground">{subtitle}</div> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onSearch ? <SearchInput label={searchLabel} onSearch={onSearch} defaultValue={searchDefaultValue} className="max-md:hidden" /> : null}
          {action ? <span className="max-md:hidden">{action}</span> : null}
          {actions}
          {action && onAction ? (
            <Button size="icon" icon={actionIcon ?? <Plus />} aria-label={actionLabel} onClick={onAction} loading={actionPending} className="md:hidden" />
          ) : null}
        </div>
      </div>
      {onSearch ? (
        <div className="px-5 pb-3 md:hidden">
          <SearchInput label={searchLabel} onSearch={onSearch} defaultValue={searchDefaultValue} className="w-full" />
        </div>
      ) : null}
    </div>
  );
}
