"use client";

import * as React from "react";
import { addDays } from "date-fns";

import { DatePicker } from "@/components/arbiter/date-picker";
import { DateRangePicker } from "@/components/arbiter/date-range-picker";
import { DateTimePicker } from "@/components/arbiter/date-time-picker";
import { DateTimeRangePicker } from "@/components/arbiter/date-time-range-picker";
import { TimePicker } from "@/components/arbiter/time-picker";

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-3">
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

export function PickersSection() {
  // Fixed at mount so filled demos stay stable while the page is open.
  const [today] = React.useState(() => new Date());
  const at = (days: number, h: number, m = 0) => {
    const d = addDays(today, days);
    d.setHours(h, m, 0, 0);
    return d;
  };
  const err = "Pick a date inside the test window";

  return (
    <section id="pickers" className="grid scroll-mt-20 grid-cols-1 gap-4">
      <div>
        <div className="text-sm font-semibold">Date and time pickers</div>
        <p className="text-xs text-muted-foreground">
          Dates and times are picked, never typed. Monday-first grid, 12-hour display, 24-hour values.
        </p>
      </div>

      <Group title="DatePicker">
        <DatePicker label="Run date" today={today} />
        <DatePicker label="Run date" today={today} value={today} />
        <DatePicker label="Run date" today={today} error={err} />
        <DatePicker label="Run date" today={today} value={today} disabled />
      </Group>

      <Group title="TimePicker">
        <TimePicker label="Start time" />
        <TimePicker label="Start time" value="14:30" />
        <TimePicker label="Start time" error="Pick a time inside the test window" />
        <TimePicker label="Start time (24h)" value="09:15" format="24h" minuteStep={15} disabled />
      </Group>

      <Group title="DateTimePicker">
        <DateTimePicker label="Window opens" today={today} />
        <DateTimePicker label="Window opens" today={today} value={at(1, 18, 30)} />
        <DateTimePicker label="Window opens" today={today} error={err} />
        <DateTimePicker label="Window opens" today={today} value={at(1, 18, 30)} disabled />
      </Group>

      <Group title="DateRangePicker">
        <DateRangePicker label="Compare period" today={today} />
        <DateRangePicker label="Compare period" today={today} value={{ start: addDays(today, -6), end: today }} />
        <DateRangePicker label="Compare period" today={today} error="Pick a range of 90 days or less" />
        <DateRangePicker label="Compare period" today={today} value={{ start: addDays(today, -6), end: today }} disabled />
      </Group>

      <Group title="DateTimeRangePicker">
        <DateTimeRangePicker label="Test window" today={today} />
        <DateTimeRangePicker label="Test window" today={today} value={{ start: at(1, 18), end: at(1, 22) }} />
        <DateTimeRangePicker label="Test window" today={today} error="Window must end after it starts" />
        <DateTimeRangePicker label="Test window" today={today} value={{ start: at(1, 18), end: at(1, 22) }} disabled />
      </Group>
    </section>
  );
}
