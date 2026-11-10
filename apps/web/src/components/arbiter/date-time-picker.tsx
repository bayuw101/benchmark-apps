"use client";

import * as React from "react";
import { CalendarClock } from "lucide-react";

import { fmtDateTime, timeOf, withTime } from "@/lib/time";
import { Calendar } from "@/components/ui/calendar";
import { Popover } from "@/components/ui/popover";
import { PHONE_QUERY, useMediaQuery } from "@/lib/use-media-query";
import { PickerFooter, PickerSurface, PickerTrigger, TimeColumns, useValue, type PickerBase } from "@/components/arbiter/picker-internals";

export interface DateTimePickerProps extends PickerBase {
  value?: Date | null;
  onChange?: (date: Date) => void;
}

export function DateTimePicker({ value, onChange, today, format = "12h", minuteStep, defaultOpen, ...field }: DateTimePickerProps) {
  const phone = useMediaQuery(PHONE_QUERY);
  const [open, setOpen] = React.useState(!!defaultOpen);
  const [date, setDate] = useValue<Date | null>(value, null, (d) => d && onChange?.(d));
  const time = date ? timeOf(date) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PickerTrigger {...field} open={open} display={date ? fmtDateTime(date, format) : ""} fallbackIcon={<CalendarClock />} />
      <PickerSurface
        title={field.label}
        open={open}
        onOpenChange={setOpen}
        footer={phone ? <PickerFooter applyLabel="Done" onApply={() => setOpen(false)} /> : undefined}
      >
        <div className="flex flex-col gap-3 md:flex-row">
          <Calendar
            mode="single"
            selected={date ?? undefined}
            defaultMonth={date ?? today}
            today={today}
            className="max-md:mx-auto"
            onSelect={(d) => d && setDate(withTime(d, time ?? "09:00"))}
          />
          <div className="border-border max-md:border-t max-md:pt-3 md:border-l md:pl-3">
            <TimeColumns
              value={time}
              format={format}
              minuteStep={minuteStep}
              onChange={(v) => setDate(withTime(date ?? today ?? new Date(), v))}
              className="max-md:[&_[role=listbox]]:h-44 max-md:[&_[role=listbox]]:w-full max-md:[&>div]:flex-1"
            />
          </div>
        </div>
      </PickerSurface>
    </Popover>
  );
}
