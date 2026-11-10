"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, LogOut, Moon, Settings, Sparkles, Sun, User } from "lucide-react";

import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/button";
import { LinkPending } from "@/components/arbiter/link-pending";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ContentCardContext } from "@/components/arbiter/content-card";
import { ShellAsideContext } from "@/components/arbiter/shell-aside";
import { Breadcrumbs } from "@/components/arbiter/breadcrumbs";

export interface NavItem {
  label: string;
  icon: React.ReactNode;
  href?: string;
  active?: boolean;
  badge?: string;
  onSelect?: () => void;
}

export interface AppShellProps {
  /** Arbiter mark per ground: light-ground PNG in light, dark-ground PNG in dark. */
  logo?: { light: string; dark: string; alt?: string };
  brand?: React.ReactNode;
  nav: NavItem[];
  bottomNav?: NavItem[];
  breadcrumbs?: string[];
  /** Pinned first breadcrumb item (the active project). Never collapses on narrow screens. */
  projectSwitcher?: React.ReactNode;
  user: { name: string; role: string; email?: string };
  theme?: "light" | "dark";
  onToggleTheme?: () => void;
  onLogout?: () => void;
  /** Sign-out in progress: the avatar shows a spinner. */
  loggingOut?: boolean;
  aiOpen?: boolean;
  onToggleAI?: () => void;
  aiPanel?: React.ReactNode;
  /** Fill a parent box instead of the viewport (gallery, embeds). */
  contained?: boolean;
  children?: React.ReactNode;
}

function Mark({ logo, size }: { logo: NonNullable<AppShellProps["logo"]>; size: number }) {
  const cls = "block object-contain";
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny static marks, theme-swapped by CSS */}
      <img src={logo.light} alt={logo.alt ?? "Arbiter"} width={size} height={size} className={cn(cls, "dark:hidden")} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo.dark} alt={logo.alt ?? "Arbiter"} width={size} height={size} className={cn(cls, "hidden dark:block")} />
    </>
  );
}

const tile =
  "relative flex flex-col items-center justify-center rounded-nav border border-transparent text-shell-muted no-underline transition-[background-color,color,border-color] duration-150 hover:border-border hover:bg-card hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand aria-[current=page]:border-border aria-[current=page]:bg-card aria-[current=page]:text-primary aria-[current=page]:shadow-sm";

function NavTile({ item, mobile }: { item: NavItem; mobile?: boolean }) {
  const className = cn(
    tile,
    mobile ? "h-[52px] min-w-14 shrink-0 gap-0.5 px-2 py-1 text-label font-medium first:ml-auto last:mr-auto" : "h-[60px] w-[62px] gap-1 px-1 py-2",
  );
  const content = (
    <>
      <span className="flex size-5 items-center justify-center [&_svg]:size-5">{item.href ? <LinkPending className="size-4">{item.icon}</LinkPending> : item.icon}</span>
      <span className={cn("max-w-full truncate font-medium", mobile ? "text-label" : "text-xs leading-4")}>{item.label}</span>
      {item.badge ? (
        <span className="absolute top-[5px] right-2.5 h-3.5 min-w-3.5 rounded-full bg-danger px-[3px] text-center text-[9px] leading-3.5 font-bold text-white">
          {item.badge}
        </span>
      ) : null}
    </>
  );
  const common = { className, "aria-current": item.active ? ("page" as const) : undefined };
  return item.href ? (
    <Link href={item.href} {...common} aria-label={item.badge ? `${item.label}, ${item.badge} pending` : item.label}>
      {content}
    </Link>
  ) : (
    <button type="button" {...common} onClick={item.onSelect}>{content}</button>
  );
}

function UserMenu({ user, theme, onToggleTheme, onLogout, loggingOut }: Pick<AppShellProps, "user" | "theme" | "onToggleTheme" | "onLogout" | "loggingOut">) {
  const initials = user.name.split(" ").map((s) => s[0]).slice(0, 2).join("");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group -my-1 flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-shell-foreground transition-colors duration-150 outline-none hover:bg-shell-hover focus-visible:shadow-focus"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-label font-bold text-primary-foreground">
            {loggingOut ? <Spinner /> : initials}
          </span>
          <span className="grid leading-tight max-md:hidden">
            <span className="text-xs font-medium">{user.name}</span>
            <span className="text-label text-shell-muted">{user.role}</span>
          </span>
          <ChevronDown className="size-3 opacity-60 transition-transform duration-200 group-data-[state=open]:rotate-180 max-md:hidden" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <div className="mb-1 border-b border-border px-3 py-2.5">
          <div className="text-xs font-medium">{user.name}</div>
          {user.email ? <div className="text-label text-muted-foreground">{user.email}</div> : null}
        </div>
        <DropdownMenuItem><User />Profile</DropdownMenuItem>
        <DropdownMenuItem><Settings />Settings</DropdownMenuItem>
        {onToggleTheme ? (
          <DropdownMenuItem className="md:hidden" onSelect={onToggleTheme}>
            {theme === "dark" ? <Sun /> : <Moon />}
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onLogout}><LogOut />Log out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const bareBtn =
  "flex size-8 cursor-pointer items-center justify-center rounded-lg text-shell-muted transition-colors duration-150 outline-none hover:bg-shell-hover hover:text-shell-foreground focus-visible:shadow-focus";

/** The whole frame: shell ground, 80px sidebar of labelled tiles, 60px topbar, floating content card, mobile bottom nav. */
export function AppShell({
  logo, brand, nav, bottomNav = [], breadcrumbs = [], projectSwitcher, user, theme, onToggleTheme, onLogout, loggingOut,
  aiOpen, onToggleAI, aiPanel, contained, children,
}: AppShellProps) {
  const [card, setCard] = React.useState<HTMLDivElement | null>(null);
  // Page-owned right panel (ShellAside), e.g. the Runs "In progress" rail. The AI panel wins when both are open.
  const [asideEl, setAsideEl] = React.useState<HTMLDivElement | null>(null);
  const [asideOpen, setAsideOpen] = React.useState(false);
  const aside = React.useMemo(() => ({ container: asideEl, setOpen: setAsideOpen }), [asideEl]);
  const showAside = asideOpen && !aiPanel;
  return (
    // Fixed to the viewport: the page never scrolls, only <main> inside the card does,
    // so the card stays an island with all four rounded corners visible.
    <div className={cn("relative flex overflow-hidden bg-shell", contained ? "h-full min-h-0" : "h-dvh")}>
      <nav aria-label="Primary" className="flex w-20 shrink-0 flex-col items-center gap-3 overflow-y-auto pt-4 pb-2.5 [scrollbar-width:none] max-md:hidden">
        <div className="flex size-[30px] items-center justify-center">
          {logo ? <Mark logo={logo} size={30} /> : brand ?? (
            <span className="flex size-9 items-center justify-center rounded-lg bg-shell-foreground text-sm font-bold text-shell">A</span>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1">{nav.map((n) => <NavTile key={n.label} item={n} />)}</div>
        <div className="flex flex-col gap-1">{bottomNav.map((n) => <NavTile key={n.label} item={n} />)}</div>
      </nav>

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col pr-2.5 pb-2.5 transition-[padding] duration-300 max-md:px-2 max-md:pb-[72px]",
          aiOpen && "md:pr-[calc(360px+10px)]",
          showAside && "xl:pr-[calc(360px+10px)]",
        )}
      >
        <header className="flex h-[60px] shrink-0 items-center justify-between gap-3 px-4 text-shell-muted">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            {/* The mark is its own element (mobile only; desktop has it in the sidebar): never part of, or hidden by, the breadcrumb. */}
            {logo ? <span className="flex shrink-0 md:hidden"><Mark logo={logo} size={24} /></span> : null}
            <Breadcrumbs items={breadcrumbs} homeClassName={logo ? "max-md:hidden" : undefined} leading={projectSwitcher} />
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            {onToggleAI ? (
              <button
                type="button"
                aria-label="Toggle AI assistant"
                aria-pressed={!!aiOpen}
                onClick={onToggleAI}
                className={cn(bareBtn, aiOpen && "bg-shell-active text-shell-foreground shadow-sm")}
              >
                <Sparkles className="size-4" />
              </button>
            ) : null}
            {onToggleTheme ? (
              <button type="button" aria-label="Toggle theme" onClick={onToggleTheme} className={cn(bareBtn, "max-md:hidden")}>
                {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
              </button>
            ) : null}
            <span aria-hidden className="h-6 w-px bg-shell-border" />
            <UserMenu user={user} theme={theme} onToggleTheme={onToggleTheme} onLogout={onLogout} loggingOut={loggingOut} />
          </div>
        </header>
        {/* Never overflow-hidden on the card: it clips portaled dropdowns. */}
        <div ref={setCard} className="relative flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-background shadow-sm max-md:rounded-2xl">
          <ShellAsideContext.Provider value={aside}>
          <ContentCardContext.Provider value={card}>
            <main className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto rounded-[inherit]">{children}</main>
          </ContentCardContext.Provider>
          </ShellAsideContext.Provider>
        </div>
      </div>

      {/* ShellAside slot: always mounted so pages can portal into it; visible only from xl and when a page uses it. */}
      <div ref={setAsideEl} className={cn("absolute inset-y-0 right-0 hidden w-[360px] py-2.5 pr-2.5", showAside && "xl:block")} />

      {aiPanel ? (
        <div className="absolute inset-y-0 right-0 w-[360px] animate-slide-in py-2.5 pr-2.5 max-md:fixed max-md:inset-0 max-md:z-50 max-md:w-auto max-md:p-2">
          {aiPanel}
        </div>
      ) : null}

      <nav
        aria-label="Primary"
        className={cn(
          "inset-x-0 bottom-0 z-50 hidden h-16 items-center gap-1 overflow-x-auto bg-shell px-2 max-md:flex",
          contained ? "absolute" : "fixed",
        )}
      >
        {nav.concat(bottomNav).map((n) => <NavTile key={n.label} item={n} mobile />)}
      </nav>
    </div>
  );
}
