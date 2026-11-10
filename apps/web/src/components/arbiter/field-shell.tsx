"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/*
 * Floating-label field shell (design system "InputField" family).
 * h-11, the label IS the placeholder, no native validation. Errors come from the server
 * as structured field errors: red border + ring, red label, micro error text.
 */

export interface FieldBaseProps {
  label: string;
  error?: string;
  hint?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
}

interface FieldShellProps extends FieldBaseProps {
  inputId: string;
  focused: boolean;
  filled: boolean;
  tall?: boolean;
  open?: boolean;
  chevron?: boolean;
  /** The bordered box, for overlays that must align to the whole field (not just the inner control). */
  boxRef?: React.Ref<HTMLDivElement>;
  children: React.ReactNode;
}

export function FieldShell({
  label, error, hint, icon, disabled, className, inputId, focused, filled, tall, open, chevron, boxRef, children,
}: FieldShellProps) {
  const floating = focused || filled;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className={cn("grid min-w-0 grid-cols-1 content-start gap-1 self-start", className)}>
      <div
        ref={boxRef}
        className={cn(
          "relative flex min-h-11 rounded-lg border border-border bg-card transition-[border-color,box-shadow] duration-150",
          icon ? "items-start" : "items-center",
          focused && "border-field-focus shadow-[0_0_0_2px_var(--field-ring)]",
          // Error = red border only. The design system's danger-soft halo has no dark value and
          // showed as a bright ring in dark mode, so it is dropped (shadow-none also wins over focus).
          error && "border-danger shadow-none",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        {icon ? (
          <span className="m-[7px] mr-3 flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground [&_svg]:size-3.5">
            {icon}
          </span>
        ) : null}
        <div className="relative min-w-0 flex-1 self-stretch">
          <label
            htmlFor={inputId}
            className={cn(
              "pointer-events-none absolute whitespace-nowrap text-sm text-muted-foreground transition-all duration-150",
              icon ? "left-0" : "left-3",
              floating
                ? "top-[5px] translate-y-0 text-label font-medium"
                : icon || tall
                  ? "top-[21px] -translate-y-1/2"
                  : "top-1/2 -translate-y-1/2",
              focused && floating && "text-field-focus",
              error && "text-danger",
            )}
          >
            {label}
          </label>
          {React.isValidElement<Record<string, unknown>>(children)
            ? React.cloneElement(children, { "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })
            : children}
        </div>
        {chevron ? (
          // Rotate the icon itself: rotating this padded wrapper spun it around a point 6px off the
          // arrow's centre and threw the open chevron ~12px to the right.
          <span className="pointer-events-none flex self-center pr-3 text-muted-foreground">
            <ChevronDown className={cn("size-3.5 transition-transform duration-200", open && "rotate-180")} />
          </span>
        ) : null}
      </div>
      {error ? (
        <p id={`${inputId}-error`} className="text-micro font-medium text-danger">{error}</p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-micro text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** Class for the control inside the shell (input, textarea, trigger button). */
export function fieldControlClass(hasIcon: boolean, error?: boolean) {
  return cn(
    "block w-full border-0 bg-transparent pt-[18px] pb-[3px] font-sans text-sm leading-normal text-foreground outline-none",
    hasIcon ? "pr-3 pl-0" : "px-3",
    error && "text-danger",
  );
}
