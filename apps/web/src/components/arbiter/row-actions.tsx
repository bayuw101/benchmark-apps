"use client";

import * as React from "react";
import { Ellipsis } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/* RowActions: three-dot menu, portaled, destructive items red. */
export interface RowAction {
  label: string;
  icon?: React.ReactNode;
  destructive?: boolean;
  onSelect?: () => void;
}

export function RowActions({ actions, label = "Row actions" }: { actions: RowAction[]; label?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} icon={<Ellipsis />} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {actions.map((a) => (
          <DropdownMenuItem key={a.label} variant={a.destructive ? "destructive" : "default"} onSelect={a.onSelect}>
            {a.icon}
            {a.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
