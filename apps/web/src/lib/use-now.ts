"use client";

import { useEffect, useState } from "react";

/** The current time, re-rendering every `intervalMs` (for ticking elapsed timers). */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
