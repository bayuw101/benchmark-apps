import { format as fmt } from "date-fns";

/*
 * Time helpers shared by the pickers. Values travel as 24-hour "HH:mm" strings or Date;
 * the UI shows 12-hour with AM/PM by default (design system rule).
 */

export type TimeFormat = "12h" | "24h";

export const pad = (n: number) => String(n).padStart(2, "0");

/** "9:05" | "09:05" | "23:59" → { h, m }; anything else (incl. "24:00") → null. */
export function parseTime(v?: string): { h: number; m: number } | null {
  const match = v ? /^(\d{1,2}):(\d{2})$/.exec(v) : null;
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h < 24 && m < 60 ? { h, m } : null;
}

export function formatTime(v: string | undefined, format: TimeFormat) {
  const t = parseTime(v);
  if (!t) return "";
  if (format === "24h") return `${pad(t.h)}:${pad(t.m)}`;
  return `${t.h % 12 || 12}:${pad(t.m)} ${t.h < 12 ? "AM" : "PM"}`;
}

export const timeOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** A copy of `d` at the given "HH:mm" (00:00 when unparsable), seconds cleared. */
export function withTime(d: Date, v: string) {
  const t = parseTime(v) ?? { h: 0, m: 0 };
  const out = new Date(d);
  out.setHours(t.h, t.m, 0, 0);
  return out;
}

export const fmtDate = (d: Date) => fmt(d, "d MMM yyyy");
export const fmtDateTime = (d: Date, format: TimeFormat) => `${fmtDate(d)}, ${formatTime(timeOf(d), format)}`;

/** Length of a span for summaries: "45 min", "8 h", "8 h 30 min", "2 d 3 h". Rounds to the minute. */
export function formatDuration(ms: number) {
  const total = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  if (d) return h ? `${d} d ${h} h` : `${d} d`;
  if (h) return m ? `${h} h ${m} min` : `${h} h`;
  return `${m} min`;
}

/** Inclusive calendar-day count label: "1 day", "7 days". */
export const dayCount = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/** History group label: "Today", "Yesterday", else "Thu 5 Nov". */
export function dayLabel(d: Date, now: Date = new Date()) {
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return fmt(d, d.getFullYear() === now.getFullYear() ? "EEE d MMM" : "EEE d MMM yyyy");
}

/** Short relative time for lists: "just now", "12 min ago", "3 h ago", "2 d ago". */
export function relativeTime(d: Date, now: Date = new Date()) {
  const min = Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

/** Clock-style elapsed time: "6:12", "1:04:09". */
export function clock(totalSec: number) {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
