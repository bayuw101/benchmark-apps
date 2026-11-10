"use client";

import * as React from "react";
import { XIcon } from "lucide-react";
import { Dialog as SheetPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Restyled to Arbiter Benchmark UI "RightPullSheet": card, left hairline, shadow-xl, max 448px, slide-in.
// `showOverlay={false}` for the design-system sheet (no backdrop). `contained` = inside the nearest positioned parent.

function Sheet(props: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger(props: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose(props: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal(props: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-40 bg-black/40 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  );
}

function SheetContent({
  className,
  children,
  showCloseButton = true,
  showOverlay = true,
  contained = false,
  container,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  showCloseButton?: boolean;
  showOverlay?: boolean;
  /** Absolute positioning inside a positioned parent instead of fixed to the viewport. */
  contained?: boolean;
  /** With `contained`: portal into this element (e.g. the AppShell content card) instead of rendering inline. */
  container?: HTMLElement | null;
}) {
  const body = (
    <>
      {showOverlay ? <SheetOverlay className={contained ? "absolute rounded-[inherit]" : undefined} /> : null}
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          // md+ : a panel docked to the card's right edge (right corners follow the card, left border only).
          // Below md the shell is the phone layout and the sheet fills the whole card, so it is a
          // fully rounded tile with a full border (rounded-2xl card minus its 1px border = 15px).
          contained
            ? "absolute max-md:rounded-[calc(var(--radius-2xl)-1px)] md:rounded-r-[inherit]"
            : "fixed max-md:inset-2 max-md:h-auto max-md:w-auto max-md:rounded-2xl",
          "top-0 right-0 z-40 flex h-full w-full flex-col border border-border bg-card text-foreground shadow-xl outline-none data-[state=open]:animate-slide-in sm:max-w-[448px] md:border-0 md:border-l",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <SheetPrimitive.Close asChild>
            <Button variant="ghost" size="icon" aria-label="Close" icon={<XIcon />} className="absolute top-3.5 right-4" />
          </SheetPrimitive.Close>
        ) : null}
      </SheetPrimitive.Content>
    </>
  );
  if (contained && !container) return body;
  return <SheetPortal container={container ?? undefined}>{body}</SheetPortal>;
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sheet-header" className={cn("border-b border-border px-5 py-4 pr-14", className)} {...props} />;
}

function SheetBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sheet-body" className={cn("grid flex-1 content-start gap-3 overflow-y-auto p-5", className)} {...props} />;
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sheet-footer" className={cn("flex justify-end gap-2 border-t border-border px-5 py-3", className)} {...props} />;
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title data-slot="sheet-title" className={cn("text-base leading-6 font-semibold", className)} {...props} />;
}

function SheetDescription({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description data-slot="sheet-description" className={cn("mt-0.5 text-xs text-muted-foreground", className)} {...props} />
  );
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetBody, SheetFooter, SheetTitle, SheetDescription };
