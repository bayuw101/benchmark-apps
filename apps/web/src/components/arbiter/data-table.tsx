"use client";

import * as React from "react";
import { SearchX } from "lucide-react";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/arbiter/empty-state";

/* DataTable: skeleton rows while loading, EmptyState when empty */

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  render?: (row: T) => React.ReactNode;
  className?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  getRowKey?: (row: T) => string;
  isLoading?: boolean;
  /** Empty because of a filter: shows noResultState instead of emptyState. */
  hasActiveFilter?: boolean;
  emptyState?: React.ReactNode;
  noResultState?: React.ReactNode;
  onRowClick?: (row: T) => void;
  selectedKey?: string;
  /** Accessible name for the table. */
  label?: string;
}

export function DataTable<T>({
  columns, rows, getRowKey, isLoading, hasActiveFilter, emptyState, noResultState, onRowClick, selectedKey, label,
}: DataTableProps<T>) {
  if (isLoading) {
    return (
      <div className="grid gap-2" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-10" />
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-12" style={{ opacity: 1 - i * 0.15 }} />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return hasActiveFilter
      ? <>{noResultState ?? <EmptyState icon={<SearchX />} title="No matching results" description="Try a different search or clear the filters." />}</>
      : <>{emptyState ?? <EmptyState title="Nothing here yet" />}</>;
  }
  const value = (row: T, key: string) => (row as Record<string, React.ReactNode>)[key];
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <Table aria-label={label}>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((c) => (
              <TableHead key={c.key} className={c.className}>{c.header}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => {
            const key = getRowKey ? getRowKey(row) : String(i);
            return (
              <TableRow
                key={key}
                data-state={key === selectedKey ? "selected" : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? (e) => { if (e.key === "Enter") onRowClick(row); } : undefined}
                className={cn(onRowClick && "cursor-pointer outline-none focus-visible:bg-muted")}
              >
                {columns.map((c) => (
                  <TableCell key={c.key} className={c.className}>
                    {c.render ? c.render(row) : value(row, c.key)}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/** Column className helpers matching the design system cells. */
export const cell = {
  mono: "font-mono text-xs text-muted-foreground",
  primary: "font-medium",
  right: "text-right",
};
