"use client";

import * as React from "react";
import { CalendarClock } from "lucide-react";
import type { DateRange as DayPickerRange } from "react-day-picker";

import { fmtDate, fmtDateTime, formatDuration, formatTime, timeOf, withTime } from "@/lib/time";
import { Calendar } from "@/components/ui/calendar";
import { Popover } from "@/components/ui/popover";
import {
  PickerFooter, PickerSurface, PickerTrigger, RangeEnds, TimeColumns, toPicker, useValue,
  type DateRange, type PickerBase,
} from "@/components/arbiter/picker-internals";

export interface DateTimeRangePickerProps extends PickerBase {
  value?: DateRange | null;
  onChange?: (range: DateRange) => void;
}

/**
 * A span with times (e.g. a test window). Days on the calendar; one full-height set of time
 * columns edits whichever end is selected in the Start → End header. Nothing applies until Apply.
 */
export function DateTimeRangePicker({ value, onChange, today, format = "12h", minuteStep, defaultOpen, ...field }: DateTimeRangePickerProps) {
  const [open, setOpen] = React.useState(!!defaultOpen);
  const [range, setRange] = useValue<DateRange | null>(value, null, (r) => r && onChange?.(r));
  const [days, setDays] = React.useState<DayPickerRange | undefined>(toPicker(range));
  const [startTime, setStartTime] = React.useState(range ? timeOf(range.start) : "09:00");
  const [endTime, setEndTime] = React.useState(range ? timeOf(range.end) : "17:00");
  const [editing, setEditing] = React.useState<"start" | "end">("start");

  function openChange(next: boolean) {
    if (next) {
      setDays(toPicker(range));
      setStartTime(range ? timeOf(range.start) : "09:00");
      setEndTime(range ? timeOf(range.end) : "17:00");
      setEditing("start");
    }
    setOpen(next);
  }

  const start = days?.from ? withTime(days.from, startTime) : null;
  // One day picked = a window inside that day.
  const end = days?.from ? withTime(days.to ?? days.from, endTime) : null;
  const invalid = !!start && !!end && end <= start;
  const summary = !start
    ? "Pick the days, then the times"
    : invalid
      ? "End must be after start"
      : `Duration ${formatDuration(end!.getTime() - start.getTime())}`;

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PickerTrigger
        {...field}
        open={open}
        display={range ? `${fmtDateTime(range.start, format)} – ${fmtDateTime(range.end, format)}` : ""}
        fallbackIcon={<CalendarClock />}
      />
      <PickerSurface
        title={field.label}
        open={open}
        onOpenChange={openChange}
        footer={
          <PickerFooter
            summary={summary}
            error={invalid}
            canApply={!!start && !invalid}
            onCancel={() => setOpen(false)}
            onApply={() => {
              setRange({ start: start!, end: end! });
              setOpen(false);
            }}
          />
        }
      >
        <div className="grid gap-3">
          <RangeEnds
            start={start ? { date: fmtDate(start), time: formatTime(startTime, format) } : undefined}
            end={end ? { date: fmtDate(end), time: formatTime(endTime, format) } : undefined}
            active={editing}
            onActivate={setEditing}
          />
          <div className="flex flex-col gap-3 md:flex-row">
            <Calendar mode="range" selected={days} onSelect={setDays} defaultMonth={days?.from ?? today} today={today} className="max-md:mx-auto" />
            <div className="border-border max-md:border-t max-md:pt-3 md:border-l md:pl-3">
              <div className="mb-1 text-xs font-semibold">{editing === "start" ? "Start time" : "End time"}</div>
              <TimeColumns
                key={editing}
                value={editing === "start" ? startTime : endTime}
                onChange={editing === "start" ? setStartTime : setEndTime}
                format={format}
                minuteStep={minuteStep}
                className="max-md:[&_[role=listbox]]:h-44 max-md:[&_[role=listbox]]:w-full max-md:[&>div]:flex-1"
              />
            </div>
          </div>
        </div>
      </PickerSurface>
    </Popover>
  );
}
