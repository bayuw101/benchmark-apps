"use client";

import * as React from "react";
import { X } from "lucide-react";

import { useContentCard } from "@/components/arbiter/content-card";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/**
 * Where a page-level overlay renders. Default: inside the AppShell content card (portal), so it
 * covers only the card; outside an AppShell, the viewport. `true` = inline in the nearest
 * positioned parent; `false` = always the viewport.
 */
function usePlacement(contained: boolean | undefined) {
  const card = useContentCard();
  if (contained === true) return { contained: true, container: undefined };
  if (contained === false || !card) return { contained: false, container: undefined };
  return { contained: true, container: card };
}

/* RightPullSheet: no backdrop, closes only via its X or Cancel (Escape kept for keyboard users). */
export interface RightPullSheetProps {
  open: boolean;
  title: string;
  subtitle?: string;
  footer?: React.ReactNode;
  onClose?: () => void;
  /** Default: slides in over the AppShell content card only. true = nearest positioned parent; false = viewport. */
  contained?: boolean;
  /** 640px instead of 448px, for forms with two-column rows (e.g. Create run). */
  wide?: boolean;
  children?: React.ReactNode;
}

export function RightPullSheet({ open, title, subtitle, footer, onClose, contained, wide, children }: RightPullSheetProps) {
  const placement = usePlacement(contained);
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose?.()} modal={false}>
      <SheetContent
        showOverlay={false}
        {...placement}
        className={wide ? "sm:max-w-[640px]" : undefined}
        onInteractOutside={(e) => e.preventDefault()}
        {...(subtitle ? {} : { "aria-describedby": undefined })}
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {subtitle ? <SheetDescription>{subtitle}</SheetDescription> : null}
        </SheetHeader>
        <SheetBody>{children}</SheetBody>
        {footer ? <SheetFooter>{footer}</SheetFooter> : null}
      </SheetContent>
    </Sheet>
  );
}

/** A Cancel button that closes the RightPullSheet it sits in. */
export function SheetCancel({ children = "Cancel" }: { children?: React.ReactNode }) {
  return (
    <SheetClose asChild>
      <Button variant="outline" icon={<X />}>{children}</Button>
    </SheetClose>
  );
}
