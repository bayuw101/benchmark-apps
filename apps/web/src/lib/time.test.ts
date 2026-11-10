import { describe, expect, it } from "vitest";
import { clock, dayCount, dayLabel, formatDuration, formatTime, parseTime, relativeTime, timeOf, withTime } from "./time";

describe("parseTime", () => {
  it("accepts H:mm and HH:mm", () => {
    expect(parseTime("9:05")).toEqual({ h: 9, m: 5 });
    expect(parseTime("23:59")).toEqual({ h: 23, m: 59 });
  });
  it("rejects out-of-range and malformed values", () => {
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime("12:60")).toBeNull();
    expect(parseTime("noon")).toBeNull();
    expect(parseTime(undefined)).toBeNull();
  });
});

describe("formatTime", () => {
  it("shows 12h with AM/PM, keeps 24h on request", () => {
    expect(formatTime("00:00", "12h")).toBe("12:00 AM");
    expect(formatTime("12:30", "12h")).toBe("12:30 PM");
    expect(formatTime("14:05", "12h")).toBe("2:05 PM");
    expect(formatTime("14:05", "24h")).toBe("14:05");
    expect(formatTime("bad", "12h")).toBe("");
  });
});

describe("withTime / timeOf", () => {
  it("round-trips and clears seconds", () => {
    const d = withTime(new Date(2026, 10, 7, 1, 2, 3), "18:45");
    expect(timeOf(d)).toBe("18:45");
    expect(d.getSeconds()).toBe(0);
    expect(d.getDate()).toBe(7);
  });
});

describe("formatDuration", () => {
  const min = 60000;
  it("picks the two largest units", () => {
    expect(formatDuration(45 * min)).toBe("45 min");
    expect(formatDuration(8 * 60 * min)).toBe("8 h");
    expect(formatDuration(8.5 * 60 * min)).toBe("8 h 30 min");
    expect(formatDuration((2 * 24 + 3) * 60 * min)).toBe("2 d 3 h");
    expect(formatDuration(7 * 24 * 60 * min)).toBe("7 d");
  });
  it("never goes negative", () => {
    expect(formatDuration(-5 * min)).toBe("0 min");
  });
});

describe("dayCount", () => {
  it("singular and plural", () => {
    expect(dayCount(1)).toBe("1 day");
    expect(dayCount(7)).toBe("7 days");
  });
});

describe("list time helpers", () => {
  const now = new Date(2026, 10, 7, 10, 0);
  it("labels days", () => {
    expect(dayLabel(new Date(2026, 10, 7, 0, 5), now)).toBe("Today");
    expect(dayLabel(new Date(2026, 10, 6, 23, 59), now)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 10, 5, 12, 0), now)).toBe("Thu 5 Nov");
    expect(dayLabel(new Date(2025, 10, 5, 12, 0), now)).toBe("Wed 5 Nov 2025");
  });
  it("says how long ago", () => {
    expect(relativeTime(new Date(now.getTime() - 20_000), now)).toBe("just now");
    expect(relativeTime(new Date(now.getTime() - 12 * 60_000), now)).toBe("12 min ago");
    expect(relativeTime(new Date(now.getTime() - 3 * 3_600_000), now)).toBe("3 h ago");
    expect(relativeTime(new Date(now.getTime() - 50 * 3_600_000), now)).toBe("2 d ago");
  });
  it("formats elapsed time like a clock", () => {
    expect(clock(372)).toBe("6:12");
    expect(clock(3849)).toBe("1:04:09");
    expect(clock(-3)).toBe("0:00");
  });
});
