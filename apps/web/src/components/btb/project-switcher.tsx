"use client";

import Link from "next/link";
import { ChevronsUpDown, Settings } from "lucide-react";

import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/button";
import { LinkPending } from "@/components/arbiter/link-pending";
import { projectInitials, type Project } from "@/lib/projects";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Hint } from "@/components/ui/tooltip";

function Tile({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("flex shrink-0 items-center justify-center rounded-md bg-primary font-bold text-primary-foreground", className)}
    >
      {projectInitials(name)}
    </span>
  );
}

/**
 * The active project, shown as the first item of the breadcrumb (the project scopes everything below it).
 * Controlled: the app wires it to `useProject()`, the gallery to local state.
 */
export function ProjectSwitcher({
  projects, activeId, onChange, manageHref, pending,
}: {
  projects: Project[];
  activeId: string;
  onChange: (id: string) => void;
  /** Shown as "Manage projects" for roles that can edit projects (admins). */
  manageHref?: string;
  /** The switch is loading the new project's page. */
  pending?: boolean;
}) {
  const active = projects.find((p) => p.id === activeId) ?? projects[0];
  if (!active) return null;

  const label = (
    <>
      <Tile name={active.name} className="size-5 text-label" />
      <span className="truncate">{active.name}</span>
    </>
  );
  const triggerClass = "flex h-8 min-w-0 max-w-[7.5rem] items-center gap-2 rounded-lg px-1.5 text-xs font-medium text-shell-foreground sm:max-w-[14rem]";

  // One project: nothing to switch, so it is a label, not a button.
  if (projects.length === 1) {
    return (
      <Hint label={active.name} side="bottom">
        <span className={triggerClass}>{label}</span>
      </Hint>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Project: ${active.name}. Switch project`}
          className={cn(
            triggerClass,
            // No blue ring here (it read as a stray blue line in the header). Hover, open and keyboard
            // focus all use the sidebar-tile look instead: card fill + hairline, which stays visible without colour.
            "group cursor-pointer border border-transparent transition-colors duration-150 outline-none hover:bg-shell-hover focus-visible:border-border focus-visible:bg-card focus-visible:shadow-sm data-[state=open]:bg-shell-hover",
          )}
        >
          {label}
          {pending ? <Spinner className="size-3" /> : <ChevronsUpDown className="size-3 shrink-0 opacity-60" aria-hidden />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Project</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={active.id} onValueChange={onChange}>
          {projects.map((p) => (
            <DropdownMenuRadioItem key={p.id} value={p.id}>
              <Tile name={p.name} className="size-6 text-label" />
              <span className="grid min-w-0">
                <span className="truncate font-medium">{p.name}</span>
                {p.description ? <span className="truncate text-micro text-muted-foreground">{p.description}</span> : null}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {manageHref ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={manageHref}>
                <LinkPending>
                  <Settings />
                </LinkPending>
                Manage projects
              </Link>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
