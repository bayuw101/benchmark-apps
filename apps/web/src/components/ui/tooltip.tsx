"use client";

import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

// Small dark tooltip (primary fill). Each Tooltip carries its own provider, so no app-level wrapper is needed.

function TooltipProvider({ delayDuration = 200, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delayDuration={delayDuration} {...props} />;
}

function Tooltip(props: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  );
}

function TooltipTrigger(props: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({ className, arrowClassName, sideOffset = 4, children, ...props }: React.ComponentProps<typeof TooltipPrimitive.Content> & { arrowClassName?: string }) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-fit rounded-md bg-primary px-2 py-1 text-xs text-balance text-primary-foreground shadow-sm animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className={cn("fill-primary", arrowClassName)} />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

/**
 * A tooltip on one element, in place of the native `title` attribute (which shows late, unstyled, and never on
 * touch). The child must accept a ref and pointer handlers; keep `aria-label` on icon-only buttons.
 */
function Hint({
  label,
  children,
  side,
  className,
  arrowClassName,
}: {
  label: React.ReactNode;
  children: React.ReactElement;
  side?: React.ComponentProps<typeof TooltipPrimitive.Content>["side"];
  className?: string;
  arrowClassName?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} className={className} arrowClassName={arrowClassName}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export { Hint, Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
