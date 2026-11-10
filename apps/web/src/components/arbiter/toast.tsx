"use client";

import * as React from "react";
import { X } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { toastBaseClass, toastIcons, toastToneClass } from "@/components/ui/sonner";

/* Toast: static display (the live ones come from `notify`). Every mutation ends in one. */
type ToastTone = keyof typeof toastToneClass;

export interface ToastProps {
  tone?: ToastTone;
  title: string;
  description?: string;
  action?: React.ReactNode;
  onClose?: () => void;
  floating?: boolean;
}

export function Toast({ tone = "info", title, description, action, onClose, floating }: ToastProps) {
  return (
    <div
      role="status"
      className={cn(toastBaseClass, toastToneClass[tone], floating ? "fixed right-4 bottom-4 z-50" : "shadow-sm", "animate-in-up")}
    >
      <span className="mt-0.5">{toastIcons[tone]}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{title}</div>
        {description ? <div className="mt-1 text-xs text-muted-foreground">{description}</div> : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
      {onClose ? (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onClose}
          className="cursor-pointer rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/** Fire a toast. Requires <Toaster /> mounted once in the root layout. */
export const notify = {
  success: (title: string, description?: string) => toast.success(title, { description }),
  error: (title: string, description?: string) => toast.error(title, { description }),
  warning: (title: string, description?: string) => toast.warning(title, { description }),
  info: (title: string, description?: string) => toast.info(title, { description }),
};
