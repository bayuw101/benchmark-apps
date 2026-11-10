"use client";

import * as React from "react";
import { CalendarRange } from "lucide-react";
import { differenceInCalendarDays, isSameDay, subMonths } from "date-fns";
import type { DateRange as DayPickerRange } from "react-day-picker";

import { cn } from "@/lib/utils";
import { dayCount, fmtDate } from "@/lib/time";
import { PHONE_QUERY, useMediaQuery } from "@/lib/use-media-query";
import { Calendar } from "@/components/ui/calendar";
import { Popover } from "@/components/ui/popover";
import {
  PickerFooter, PickerSurface, PickerTrigger, RangeEnds, defaultPresets, toPicker, useValue,
  type DateRange, type PickerBase, type RangePreset,
} from "@/components/arbiter/picker-internals";

export type { DateRange, RangePreset };

export interface DateRangePickerProps extends PickerBase {
  value?: DateRange | null;
  onChange?: (range: DateRange) => void;
  presets?: RangePreset[] | false;
}

/**
 * Days only. Desktop: presets column + two months. Phones: a bottom sheet with presets as a
 * swipeable chip row and one month of 44px cells. Nothing applies until Apply.
 */
export function DateRangePicker({ value, onChange, today, presets, defaultOpen, ...field }: DateRangePickerProps) {
  const now = today ?? new Date();
  const phone = useMediaQuery(PHONE_QUERY);
  const [open, setOpen] = React.useState(!!defaultOpen);
  const [range, setRange] = useValue<DateRange | null>(value, null, (r) => r && onChange?.(r));
  const [draft, setDraft] = React.useState<DayPickerRange | undefined>(toPicker(range));
  const list = presets === false ? [] : (presets ?? defaultPresets(now));

  function openChange(next: boolean) {
    if (next) setDraft(toPicker(range));
    setOpen(next);
  }

  const complete = !!(draft?.from && draft.to);
  const isActive = (p: RangePreset) => complete && isSameDay(draft!.from!, p.start) && isSameDay(draft!.to!, p.end);
  const summary = complete
    ? `${dayCount(differenceInCalendarDays(draft!.to!, draft!.from!) + 1)} selected`
    : draft?.from
      ? "Pick an end date"
      : "Pick a start date, or a preset";

  const presetChips = list.length ? (
    <div role="group" aria-label="Presets" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {list.map((p) => (
        <button
          key={p.label}
          type="button"
          aria-pressed={isActive(p)}
          onClick={() => setDraft({ from: p.start, to: p.end })}
          className={cn(
            "h-9 shrink-0 cursor-pointer rounded-full border px-3.5 text-xs font-medium whitespace-nowrap transition-colors duration-100 outline-none focus-visible:shadow-focus",
            isActive(p) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-muted",
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  ) : null;

  const presetColumn = list.length ? (
    <div role="group" aria-label="Presets" className="flex w-32 shrink-0 flex-col gap-0.5 border-r border-border pr-3">
      {list.map((p) => (
        <button
          key={p.label}
          type="button"
          aria-pressed={isActive(p)}
          onClick={() => setDraft({ from: p.start, to: p.end })}
          className={cn(
            "h-8 cursor-pointer rounded-md px-2.5 text-left text-xs whitespace-nowrap text-foreground transition-colors duration-100 outline-none hover:bg-muted focus-visible:shadow-focus",
            isActive(p) && "bg-muted font-semibold",
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PickerTrigger
        {...field}
        open={open}
        display={range ? `${fmtDate(range.start)} – ${fmtDate(range.end)}` : ""}
        fallbackIcon={<CalendarRange />}
      />
      <PickerSurface
        title={field.label}
        open={open}
        onOpenChange={openChange}
        footer={
          <PickerFooter
            summary={summary}
            canApply={complete}
            onCancel={() => setOpen(false)}
            onApply={() => {
              setRange({ start: draft!.from!, end: draft!.to! });
              setOpen(false);
            }}
          />
        }
      >
        <div className="grid gap-3">
          <RangeEnds
            start={draft?.from && { date: fmtDate(draft.from) }}
            end={draft?.to && { date: fmtDate(draft.to) }}
            active={!draft?.from ? "start" : !draft.to ? "end" : null}
          />
          {phone ? presetChips : null}
          <div className="flex gap-3">
            {phone ? null : presetColumn}
            <Calendar
              mode="range"
              numberOfMonths={phone ? 1 : 2}
              selected={draft}
              onSelect={setDraft}
              // Desktop shows last month + this month (ranges usually look back); phones start at the selection or today.
              defaultMonth={draft?.from ?? (phone ? now : subMonths(now, 1))}
              today={today}
              className="max-md:mx-auto md:[--cell-size:--spacing(9)]"
            />
          </div>
        </div>
      </PickerSurface>
    </Popover>
  );
}
