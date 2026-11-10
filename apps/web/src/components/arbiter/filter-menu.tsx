"use client";

import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * Toolbar filter: a 32px (`control-sm`) button that reads "Target: tickets-staging" when set,
 * opening a single-choice menu with an "All" option. Sits beside SearchInput at the same height.
 */
export function FilterMenu({
  label, value, options, onChange, allLabel,
}: {
  label: string;
  value?: string;
  options: FilterOption[];
  onChange: (value: string | undefined) => void;
  /** e.g. "All targets"; defaults to "All". */
  allLabel?: string;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={current ? `${label}: ${current.label}. Change filter` : `Filter by ${label.toLowerCase()}`}
          className={cn(
            "group inline-flex h-8 max-w-[16rem] shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border bg-card px-3 text-xs whitespace-nowrap transition-colors duration-150 outline-none hover:bg-muted focus-visible:shadow-focus",
            current ? "border-border-strong text-foreground" : "border-border text-muted-foreground",
          )}
        >
          <span className="font-medium">{label}</span>
          {current ? <span className="truncate font-semibold">{current.label}</span> : null}
          <ChevronDown aria-hidden className="size-3.5 shrink-0 opacity-70 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 min-w-48 overflow-y-auto">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value ?? ""} onValueChange={(v) => onChange(v || undefined)}>
          <DropdownMenuRadioItem value="">{allLabel ?? "All"}</DropdownMenuRadioItem>
          {options.length ? <DropdownMenuSeparator /> : null}
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value}>
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
