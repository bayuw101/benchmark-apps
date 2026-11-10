"use client";

import * as React from "react";
import { CalendarDays } from "lucide-react";

import { fmtDate } from "@/lib/time";
import { Calendar } from "@/components/ui/calendar";
import { Popover } from "@/components/ui/popover";
import { PickerSurface, PickerTrigger, useValue, type PickerBase } from "@/components/arbiter/picker-internals";

export interface DatePickerProps extends PickerBase {
  value?: Date | null;
  onChange?: (date: Date) => void;
}

export function DatePicker({ value, onChange, today, defaultOpen, ...field }: DatePickerProps) {
  const [open, setOpen] = React.useState(!!defaultOpen);
  const [date, setDate] = useValue<Date | null>(value, null, (d) => d && onChange?.(d));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PickerTrigger {...field} open={open} display={date ? fmtDate(date) : ""} fallbackIcon={<CalendarDays />} />
      <PickerSurface title={field.label} open={open} onOpenChange={setOpen}>
        <Calendar
          mode="single"
          selected={date ?? undefined}
          defaultMonth={date ?? today}
          today={today}
          className="max-md:mx-auto"
          onSelect={(d) => {
            if (!d) return;
            setDate(d);
            setOpen(false);
          }}
        />
      </PickerSurface>
    </Popover>
  );
}
