"use client";

import * as React from "react";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Restyled to Arbiter Benchmark UI "ConfirmDialog": overlay token + 1px blur, 384px card, p-5, shadow-xl.
// `contained` renders inside the nearest positioned parent (the content card) instead of the viewport.

function AlertDialog(props: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

function AlertDialogTrigger(props: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />;
}

function AlertDialogPortal(props: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  return <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />;
}

function AlertDialogOverlay({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  return (
    <AlertDialogPrimitive.Overlay
      data-slot="alert-dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-overlay backdrop-blur-[1px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  );
}

function AlertDialogContent({
  className,
  contained = false,
  container,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content> & {
  /** Absolute positioning inside a positioned parent instead of fixed to the viewport. */
  contained?: boolean;
  /** With `contained`: portal into this element (e.g. the AppShell content card) instead of rendering inline. */
  container?: HTMLElement | null;
}) {
  const body = (
    <>
      <AlertDialogOverlay className={contained ? "absolute rounded-[inherit]" : undefined} />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        className={cn(
          contained ? "absolute" : "fixed",
          "top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-[384px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 text-foreground shadow-xl outline-none data-[state=open]:animate-in-up",
          className,
        )}
        {...props}
      />
    </>
  );
  if (contained && !container) return body;
  return <AlertDialogPortal container={container ?? undefined}>{body}</AlertDialogPortal>;
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-dialog-header" className={cn("grid", className)} {...props} />;
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-dialog-footer" className={cn("mt-5 flex justify-end gap-2", className)} {...props} />;
}

function AlertDialogTitle({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title data-slot="alert-dialog-title" className={cn("text-base leading-6 font-semibold", className)} {...props} />
  );
}

function AlertDialogDescription({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("mt-2 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

/** Danger icon disc above the title. */
function AlertDialogMedia({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-media"
      className={cn("mb-3 inline-flex size-9 items-center justify-center rounded-full bg-danger-soft text-danger [&_svg]:size-4", className)}
      {...props}
    />
  );
}

type ButtonPick = Pick<React.ComponentProps<typeof Button>, "variant" | "size" | "icon" | "loading">;

function AlertDialogAction({
  className, variant = "primary", size = "md", icon, loading, children, ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action> & ButtonPick) {
  return (
    <AlertDialogPrimitive.Action asChild {...props}>
      <Button variant={variant} size={size} icon={icon} loading={loading} className={className}>{children}</Button>
    </AlertDialogPrimitive.Action>
  );
}

function AlertDialogCancel({
  className, variant = "outline", size = "md", icon, loading, children, ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel> & ButtonPick) {
  return (
    <AlertDialogPrimitive.Cancel asChild {...props}>
      <Button variant={variant} size={size} icon={icon} loading={loading} className={className}>{children}</Button>
    </AlertDialogPrimitive.Cancel>
  );
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
};
