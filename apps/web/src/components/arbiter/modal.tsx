"use client";

import * as React from "react";

import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  footer?: React.ReactNode;
  onClose?: () => void;
  contained?: boolean;
  children?: React.ReactNode;
}

export function Modal({ open, title, description, footer, onClose, contained, children }: ModalProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose?.()}>
      <DialogContent contained={contained} {...(description ? {} : { "aria-describedby": undefined })}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children ? <DialogBody>{children}</DialogBody> : null}
        {footer ? <DialogFooter>{footer}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  );
}
