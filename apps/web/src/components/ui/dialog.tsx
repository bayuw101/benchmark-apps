"use client";

import * as React from "react";
import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Restyled to Arbiter Benchmark UI "Modal": card, hairline, rounded-xl, shadow-xl, max 512px,
// header/body/footer split by borders. `contained` renders inside the nearest positioned parent.

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal(props: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  contained = false,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { showCloseButton?: boolean; contained?: boolean }) {
  const body = (
    <>
      <DialogOverlay className={contained ? "absolute rounded-[inherit]" : undefined} />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          contained ? "absolute" : "fixed",
          "top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-[512px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card text-foreground shadow-xl outline-none data-[state=open]:animate-in-up",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="icon" aria-label="Close" icon={<XIcon />} className="absolute top-3 right-3" />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </>
  );
  return contained ? body : <DialogPortal>{body}</DialogPortal>;
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-header" className={cn("border-b border-border px-5 py-4 pr-12", className)} {...props} />;
}

function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-body" className={cn("grid gap-3 px-5 py-4", className)} {...props} />;
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & { showCloseButton?: boolean }) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex justify-end gap-2 border-t border-border px-5 py-3", className)}
      {...props}
    >
      {showCloseButton ? (
        <DialogPrimitive.Close asChild>
          <Button variant="outline" icon={<XIcon />}>Close</Button>
        </DialogPrimitive.Close>
      ) : null}
      {children}
    </div>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="dialog-title" className={cn("text-base leading-6 font-semibold", className)} {...props} />;
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("mt-0.5 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
