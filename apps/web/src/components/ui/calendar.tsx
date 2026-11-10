"use client";

import * as React from "react";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { DayPicker, getDefaultClassNames, type DayButton } from "react-day-picker";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

/*
 * Arbiter Benchmark UI month grid: Monday first, 32px day cells (44px touch targets on phones, rounded-lg),
 * today ringed in border-strong, selection in primary, range middle in muted.
 */
function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  weekStartsOn = 1,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  const d = getDefaultClassNames();

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      weekStartsOn={weekStartsOn}
      className={cn("group/calendar w-fit [--cell-size:--spacing(8)] max-md:[--cell-size:--spacing(11)]", className)}
      classNames={{
        root: cn("w-fit", d.root),
        months: cn("relative flex flex-col gap-5 sm:flex-row", d.months),
        month: cn("flex w-full flex-col gap-2", d.month),
        nav: cn("absolute inset-x-0 top-0 flex w-full items-center justify-between", d.nav),
        button_previous: cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "select-none aria-disabled:opacity-50",
          d.button_previous,
        ),
        button_next: cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "select-none aria-disabled:opacity-50",
          d.button_next,
        ),
        month_caption: cn("flex h-8 w-full items-center justify-center px-8", d.month_caption),
        caption_label: cn("text-sm font-semibold select-none", d.caption_label),
        month_grid: cn("border-collapse", d.month_grid),
        weekdays: cn("flex", d.weekdays),
        weekday: cn(
          "flex h-6 w-(--cell-size) items-center justify-center text-label font-medium text-muted-foreground select-none",
          d.weekday,
        ),
        week: cn("mt-0.5 flex", d.week),
        day: cn("group/day relative size-(--cell-size) p-0 text-center select-none", d.day),
        range_start: cn("rounded-l-lg bg-muted", d.range_start),
        range_middle: cn("bg-muted", d.range_middle),
        range_end: cn("rounded-r-lg bg-muted", d.range_end),
        today: d.today,
        outside: cn("text-muted-foreground", d.outside),
        disabled: cn("opacity-50", d.disabled),
        hidden: cn("invisible", d.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className, rootRef, ...p }) => <div data-slot="calendar" ref={rootRef} className={className} {...p} />,
        Chevron: ({ className, orientation, ...p }) => {
          const Icon = orientation === "left" ? ChevronLeftIcon : orientation === "right" ? ChevronRightIcon : ChevronDownIcon;
          return <Icon className={cn("size-4", className)} {...p} />;
        },
        DayButton: CalendarDayButton,
        ...components,
      }}
      {...props}
    />
  );
}

function CalendarDayButton({ className, day, modifiers, ...props }: React.ComponentProps<typeof DayButton>) {
  const ref = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  const single = modifiers.selected && !modifiers.range_start && !modifiers.range_end && !modifiers.range_middle;

  return (
    <button
      ref={ref}
      type="button"
      data-day={day.date.toLocaleDateString()}
      className={cn(
        "size-(--cell-size) cursor-pointer rounded-lg text-xs text-foreground tabular-nums max-md:text-sm transition-colors duration-100 outline-none hover:bg-muted focus-visible:shadow-focus disabled:pointer-events-none",
        modifiers.outside && "text-muted-foreground",
        modifiers.today && "font-semibold shadow-[inset_0_0_0_1px_var(--border-strong)]",
        modifiers.range_middle && "rounded-none bg-transparent hover:bg-border",
        (single || modifiers.range_start || modifiers.range_end) &&
          "bg-primary text-primary-foreground shadow-none hover:bg-primary",
        className,
      )}
      {...props}
    />
  );
}

export { Calendar, CalendarDayButton };
