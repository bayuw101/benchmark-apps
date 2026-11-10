"use client";

import * as React from "react";
import { Clock } from "lucide-react";

import { formatTime } from "@/lib/time";
import { Popover } from "@/components/ui/popover";
import { PHONE_QUERY, useMediaQuery } from "@/lib/use-media-query";
import { PickerFooter, PickerSurface, PickerTrigger, TimeColumns, useValue, type PickerBase } from "@/components/arbiter/picker-internals";

/** value is a 24-hour "HH:mm" string; the field shows 12h by default. */
export interface TimePickerProps extends PickerBase {
  value?: string;
  onChange?: (value: string) => void;
}

export function TimePicker({ value, onChange, format = "12h", minuteStep, defaultOpen, ...field }: TimePickerProps) {
  const phone = useMediaQuery(PHONE_QUERY);
  const [open, setOpen] = React.useState(!!defaultOpen);
  const [time, setTime] = useValue<string | undefined>(value, undefined, (v) => v && onChange?.(v));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PickerTrigger {...field} open={open} display={formatTime(time, format)} fallbackIcon={<Clock />} />
      <PickerSurface
        title={field.label}
        open={open}
        onOpenChange={setOpen}
        // Changes apply live; on a phone sheet there is no outside to click, so offer Done.
        footer={phone ? <PickerFooter applyLabel="Done" onApply={() => setOpen(false)} /> : undefined}
      >
        <TimeColumns
          value={time}
          onChange={setTime}
          format={format}
          minuteStep={minuteStep}
          className="max-md:[&_[role=listbox]]:w-full max-md:[&>div]:flex-1"
        />
      </PickerSurface>
    </Popover>
  );
}
