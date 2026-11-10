"use client";

import * as React from "react";
import { ArrowRight, Check, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { addDays, endOfMonth, startOfMonth, subMonths } from "date-fns";
import type { DateRange as DayPickerRange } from "react-day-picker";

import { cn } from "@/lib/utils";
import { pad, parseTime } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PHONE_QUERY, useMediaQuery } from "@/lib/use-media-query";
import { FieldShell, fieldControlClass, type FieldBaseProps } from "@/components/arbiter/field-shell";

/*
 * Arbiter Benchmark UI pickers. Dates and times are always picked, never typed.
 * Shown in 12-hour time with AM/PM by default; values are sent as 24-hour ("HH:mm") or Date.
 * This file holds what the five pickers share.
 */

export interface PickerBase extends FieldBaseProps {
  today?: Date;
  format?: "12h" | "24h";
  minuteStep?: number;
  /** Open on mount (previews). */
  defaultOpen?: boolean;
}

export interface DateRange {
  start: Date;
  end: Date;
}

export interface RangePreset {
  label: string;
  start: Date;
  end: Date;
}

/** Controlled-or-uncontrolled state: `value` wins when the parent passes it. */
export function useValue<T>(value: T | undefined, initial: T, onChange?: (v: T) => void) {
  const [inner, setInner] = React.useState<T>(initial);
  const current = value !== undefined ? value : inner;
  const set = (v: T) => {
    setInner(v);
    onChange?.(v);
  };
  return [current, set] as const;
}

/* ---------- trigger ---------- */

interface TriggerProps extends FieldBaseProps {
  open: boolean;
  display: string;
  fallbackIcon: React.ReactNode;
}

export function PickerTrigger({ open, display, fallbackIcon, ...field }: TriggerProps) {
  const autoId = React.useId();
  const id = field.id ?? autoId;
  const icon = field.icon ?? fallbackIcon;
  const boxRef = React.useRef<HTMLDivElement>(null);
  return (
    <>
      <FieldShell {...field} icon={icon} inputId={id} focused={open} filled={display.length > 0} open={open} chevron boxRef={boxRef}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            disabled={field.disabled}
            className={cn(fieldControlClass(true, !!field.error), "h-[42px] cursor-pointer truncate text-left")}
          >
            {display || " "}
          </button>
        </PopoverTrigger>
      </FieldShell>
      {/* The popover aligns to the whole field box (left edge, past the prefix icon), not the inner button. */}
      <PopoverAnchor virtualRef={boxRef as React.RefObject<HTMLDivElement>} className="hidden" />
    </>
  );
}

/* ---------- time columns: Hour · Min · AM/PM, 32px cells ---------- */

export function TimeColumn<T extends string | number>({
  label,
  items,
  selected,
  render,
  onSelect,
}: {
  label: string;
  items: T[];
  selected: T | null;
  render: (v: T) => string;
  onSelect: (v: T) => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  // Bring the selected cell into view inside the column only (never scrolls the page).
  React.useEffect(() => {
    const col = ref.current;
    const el = col?.querySelector<HTMLElement>("[aria-selected=true]");
    if (col && el) col.scrollTop = el.offsetTop - col.clientHeight / 2 + el.clientHeight / 2;
  }, [selected]);
  return (
    <div className="flex flex-col gap-1">
      <div className="h-4 px-1 text-center text-label font-medium text-muted-foreground">{label}</div>
      <div
        ref={ref}
        role="listbox"
        aria-label={label}
        className="relative flex h-56 w-14 flex-col gap-0.5 overflow-y-auto p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((v) => (
          <button
            key={String(v)}
            type="button"
            role="option"
            aria-selected={v === selected}
            onClick={() => onSelect(v)}
            className={cn(
              "h-8 shrink-0 cursor-pointer rounded-lg text-xs text-foreground tabular-nums max-md:h-10 max-md:text-sm transition-colors duration-100 outline-none hover:bg-muted focus-visible:shadow-focus",
              v === selected && "bg-primary font-semibold text-primary-foreground hover:bg-primary",
            )}
          >
            {render(v)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function TimeColumns({
  value,
  onChange,
  format = "12h",
  minuteStep = 5,
  className,
}: {
  value?: string;
  onChange: (v: string) => void;
  format?: "12h" | "24h";
  minuteStep?: number;
  /** Phones stretch the columns to the sheet width: each column is a direct child div. */
  className?: string;
}) {
  const t = parseTime(value);
  const is12 = format === "12h";
  const ampm = t ? (t.h < 12 ? "AM" : "PM") : null;
  const hours = is12 ? [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: Math.ceil(60 / minuteStep) }, (_, i) => i * minuteStep);
  const set = (h: number, m: number) => onChange(`${pad(h)}:${pad(m)}`);

  return (
    <div className={cn("flex gap-1", className)}>
      <TimeColumn
        label="Hour"
        items={hours}
        selected={t ? (is12 ? t.h % 12 || 12 : t.h) : null}
        render={(h) => (is12 ? String(h) : pad(h))}
        onSelect={(h) => set(is12 ? (h % 12) + (ampm === "PM" ? 12 : 0) : h, t?.m ?? 0)}
      />
      <TimeColumn label="Min" items={minutes} selected={t?.m ?? null} render={pad} onSelect={(m) => set(t?.h ?? 9, m)} />
      {is12 ? (
        <TimeColumn
          label="AM/PM"
          items={["AM", "PM"]}
          selected={ampm}
          render={(p) => p}
          onSelect={(p) => {
            const h = t?.h ?? 9;
            set((h % 12) + (p === "PM" ? 12 : 0), t?.m ?? 0);
          }}
        />
      ) : null}
    </div>
  );
}

/* ---------- surface: popover on desktop, bottom sheet on phones ---------- */

/**
 * Where a picker's panel opens. Desktop: a popover aligned to the field. Phones (the shell's
 * phone layout, < 768px): a bottom sheet with the field's label as title, its own scroll and a
 * footer that never leaves the screen. Must sit inside the picker's <Popover>.
 */
export function PickerSurface({
  title, open, onOpenChange, footer, children,
}: {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const phone = useMediaQuery(PHONE_QUERY);
  if (phone) {
    return (
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[1px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed inset-x-2 bottom-[calc(0.5rem+env(safe-area-inset-bottom))] z-50 flex max-h-[calc(100dvh-1rem)] flex-col rounded-2xl border border-border bg-card text-foreground shadow-xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-8"
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border py-2.5 pr-2.5 pl-4">
              <DialogPrimitive.Title className="truncate text-base font-semibold">{title}</DialogPrimitive.Title>
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon" icon={<X />} aria-label="Close" />
              </DialogPrimitive.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
            {footer}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    );
  }
  return (
    <PopoverContent align="start" collisionPadding={16} className="w-auto max-w-[calc(100vw-2rem)] p-0">
      <div className="p-3">{children}</div>
      {footer}
    </PopoverContent>
  );
}

/* ---------- Start → End header for the range pickers ---------- */

type End = "start" | "end";

/** One end of a range: the date, and for date-time ranges the time on its own line (never truncates a phone sheet). */
export interface RangeEndValue {
  date: string;
  time?: string;
}

function RangeEnd({
  label, value, active, onActivate,
}: {
  label: string;
  value?: RangeEndValue;
  active: boolean;
  onActivate?: () => void;
}) {
  const body = (
    <>
      <span className="text-label font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
      <span className={cn("truncate text-sm font-medium tabular-nums", !value && "font-normal text-muted-foreground")}>
        {value?.date ?? "Pick a date"}
      </span>
      {value?.time ? <span className="truncate text-xs text-muted-foreground tabular-nums">{value.time}</span> : null}
    </>
  );
  const cls = cn(
    "grid min-w-0 gap-0.5 rounded-lg border px-3 py-2 text-left transition-[border-color,background-color,box-shadow] duration-150",
    active ? "border-foreground bg-card shadow-sm" : "border-border bg-background",
  );
  return onActivate ? (
    <button
      type="button"
      aria-pressed={active}
      onClick={onActivate}
      className={cn(cls, "cursor-pointer outline-none hover:border-border-strong focus-visible:shadow-focus", active && "hover:border-foreground")}
    >
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/**
 * The two ends of a range, side by side. `active` = the end being picked or edited next.
 * With `onActivate` the ends are toggles (the date-time range picker edits one end's time at a time).
 */
export function RangeEnds({
  start, end, active, onActivate,
}: {
  start?: RangeEndValue;
  end?: RangeEndValue;
  active: End | null;
  onActivate?: (which: End) => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
      <RangeEnd label="Start" value={start} active={active === "start"} onActivate={onActivate && (() => onActivate("start"))} />
      <ArrowRight aria-hidden className="size-3.5 text-muted-foreground" />
      <RangeEnd label="End" value={end} active={active === "end"} onActivate={onActivate && (() => onActivate("end"))} />
    </div>
  );
}

/* ---------- footer ---------- */

/** Summary (or error) + Cancel/Apply. On phones the buttons go full width and 44px tall. */
export function PickerFooter({
  summary, error, canApply = true, onCancel, onApply, applyLabel = "Apply",
}: {
  summary?: string;
  error?: boolean;
  canApply?: boolean;
  onCancel?: () => void;
  onApply: () => void;
  applyLabel?: string;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-border px-3 py-2.5 max-md:px-4 max-md:py-3">
      {summary ? (
        <div role="status" aria-live="polite" className={cn("min-w-0 flex-1 truncate text-xs text-muted-foreground max-md:basis-full", error && "font-medium text-danger")}>
          {summary}
        </div>
      ) : null}
      <div className="ml-auto flex shrink-0 gap-2 max-md:w-full">
        {onCancel ? (
          <Button variant="outline" size="sm" icon={<X />} onClick={onCancel} className="max-md:h-11 max-md:flex-1">
            Cancel
          </Button>
        ) : null}
        <Button size="sm" icon={<Check />} disabled={!canApply} onClick={onApply} className="max-md:h-11 max-md:flex-1">
          {applyLabel}
        </Button>
      </div>
    </div>
  );
}

export const toPicker = (r: DateRange | null | undefined): DayPickerRange | undefined => (r ? { from: r.start, to: r.end } : undefined);

export function defaultPresets(today: Date): RangePreset[] {
  const lastMonth = subMonths(today, 1);
  return [
    { label: "Today", start: today, end: today },
    { label: "Last 7 days", start: addDays(today, -6), end: today },
    { label: "Last 30 days", start: addDays(today, -29), end: today },
    { label: "This month", start: startOfMonth(today), end: endOfMonth(today) },
    { label: "Last month", start: startOfMonth(lastMonth), end: endOfMonth(lastMonth) },
  ];
}
