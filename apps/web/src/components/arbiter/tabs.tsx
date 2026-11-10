"use client";

import * as React from "react";

import { Tabs as TabsRoot, TabsContent, TabsCount, TabsList, TabsTrigger } from "@/components/ui/tabs";

/* Tabs (design-system wrapper) */
export interface TabItem {
  value: string;
  label: string;
  count?: number;
  content?: React.ReactNode;
}

export function Tabs({ items, value, onChange }: { items: TabItem[]; value: string; onChange?: (value: string) => void }) {
  // Radix focuses a tab from code on mouse-down, which Chrome treats as keyboard focus and draws the ring.
  // After a pointer click, drop that focus; keyboard users (Tab, arrows) keep the ring.
  const pointer = React.useRef(false);
  // On narrow screens the tab list scrolls sideways: keep the active tab in view (e.g. opened from ?tab=).
  const listRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>("[data-state=active]");
    const list = listRef.current;
    if (active && list) list.scrollLeft = Math.max(0, active.offsetLeft - (list.clientWidth - active.offsetWidth) / 2);
  }, [value]);
  return (
    <TabsRoot
      value={value}
      onValueChange={(v) => {
        onChange?.(v);
        if (pointer.current) requestAnimationFrame(() => (document.activeElement as HTMLElement | null)?.blur());
        pointer.current = false;
      }}
    >
      <TabsList ref={listRef} onPointerDown={() => (pointer.current = true)} onKeyDown={() => (pointer.current = false)}>
        {items.map((t) => (
          <TabsTrigger key={t.value} value={t.value}>
            {t.label}
            {t.count !== undefined ? <TabsCount>{t.count}</TabsCount> : null}
          </TabsTrigger>
        ))}
      </TabsList>
      {items.map((t) =>
        t.content !== undefined ? (
          <TabsContent key={t.value} value={t.value}>
            {t.content}
          </TabsContent>
        ) : null,
      )}
    </TabsRoot>
  );
}
