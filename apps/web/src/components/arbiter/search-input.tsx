"use client";

import * as React from "react";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";

/* SearchInput: the one plain (non-floating) input, toolbar height h-8 */

export interface SearchInputProps {
  label?: string;
  onSearch?: (q: string) => void;
  debounceMs?: number;
  defaultValue?: string;
  /** Single key that focuses the field, e.g. "/". */
  shortcut?: string;
  className?: string;
}

export function SearchInput({ label = "Search", onSearch, debounceMs = 250, defaultValue = "", shortcut, className }: SearchInputProps) {
  const [q, setQ] = React.useState(defaultValue);
  const ref = React.useRef<HTMLInputElement>(null);
  const first = React.useRef(true);
  // Latest callback in a ref: an inline `onSearch` from the parent must not restart the debounce.
  const onSearchRef = React.useRef(onSearch);
  onSearchRef.current = onSearch;

  React.useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => onSearchRef.current?.(q), debounceMs);
    return () => clearTimeout(t);
  }, [q, debounceMs]);

  React.useEffect(() => {
    if (!shortcut) return;
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (e.key !== shortcut || el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      e.preventDefault();
      ref.current?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [shortcut]);

  return (
    <div
      className={cn(
        "inline-flex h-8 min-w-0 items-center gap-2 rounded-lg border border-border bg-background px-3 text-muted-foreground transition-[border-color,box-shadow] duration-150 focus-within:border-field-focus focus-within:shadow-[0_0_0_2px_var(--field-ring)]",
        className,
      )}
    >
      <Search className="size-3.5 shrink-0" aria-hidden />
      <input
        ref={ref}
        type="search"
        aria-label={label}
        placeholder={label}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-40 min-w-0 flex-1 border-0 bg-transparent font-sans text-xs text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
      />
      {shortcut ? (
        <kbd className="rounded border border-border bg-card px-1 font-mono text-label text-muted-foreground">{shortcut}</kbd>
      ) : null}
    </div>
  );
}
