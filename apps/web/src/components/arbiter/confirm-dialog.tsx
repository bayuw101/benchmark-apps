"use client";

import * as React from "react";
import { Check, Trash2, TriangleAlert, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/* ConfirmDialog: every destructive action goes through it first. */
export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  destructive?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmIcon?: React.ReactNode;
  loading?: boolean;
  /** Default: covers the whole screen, like Modal. true = covers only the nearest positioned parent. */
  contained?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
}

export function ConfirmDialog({
  open, title, description, destructive, confirmLabel = "Confirm", cancelLabel = "Cancel", confirmIcon, loading, contained, onConfirm, onCancel,
}: ConfirmDialogProps) {
  const actions = (
    <AlertDialogFooter>
      <AlertDialogCancel icon={<X />} disabled={loading}>{cancelLabel}</AlertDialogCancel>
      {/* Not an AlertDialogAction: it would close before the async confirm finishes. */}
      <Button
        variant={destructive ? "danger" : "primary"}
        icon={confirmIcon ?? (destructive ? <Trash2 /> : <Check />)}
        loading={loading}
        onClick={onConfirm}
      >
        {confirmLabel}
      </Button>
    </AlertDialogFooter>
  );
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && !loading && onCancel?.()}>
      {destructive ? (
        // Destructive: the warning icon is the background of the left 30%, oversized and cropped.
        // bg-danger/10 (not danger-soft) so the panel also reads as a tint in dark mode.
        <AlertDialogContent contained={contained} className="grid max-w-[448px] grid-cols-[30%_1fr] overflow-hidden p-0">
          <div aria-hidden className="relative overflow-hidden bg-danger/10">
            <TriangleAlert
              strokeWidth={1.5}
              className="absolute top-1/2 -left-7 size-40 -translate-y-1/2 -rotate-12 text-danger opacity-25"
            />
          </div>
          <div className="min-w-0 p-5">
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
            {actions}
          </div>
        </AlertDialogContent>
      ) : (
        <AlertDialogContent contained={contained}>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
          {actions}
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
}
