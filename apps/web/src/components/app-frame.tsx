"use client";

import { usePathname } from "next/navigation";
import { Gauge, Layers, Palette, Settings, ShieldCheck } from "lucide-react";

import { AppShell, type NavItem } from "@/components/arbiter/app-shell";
import { notify } from "@/components/arbiter/toast";
import { ProjectSwitcher } from "@/components/btb/project-switcher";
import { useProject } from "@/components/project-provider";
import { signOut } from "@/app/login/actions";
import { useNavigate } from "@/components/navigation";
import { ROLE_LABEL, type Role, type SessionUser } from "@/lib/session";
import { useTheme } from "@/lib/use-theme";

// Nav labels max ~8 chars (design system), so Approvals → Reviews, Scenarios → Catalog.
const NAV: (Omit<NavItem, "active"> & { href: string; crumb: string; roles?: Role[] })[] = [
  { label: "Runs", href: "/runs", crumb: "Runs", icon: <Gauge strokeWidth={1.75} /> },
  // Whether admins also approve is an open question (UI plan, "role hierarchy").
  { label: "Reviews", href: "/approvals", crumb: "Approvals", icon: <ShieldCheck strokeWidth={1.75} />, roles: ["approver", "admin"] },
  { label: "Catalog", href: "/scenarios", crumb: "Scenarios", icon: <Layers strokeWidth={1.75} /> },
  { label: "Admin", href: "/admin", crumb: "Admin", icon: <Settings strokeWidth={1.75} />, roles: ["admin"] },
];
const BOTTOM = [{ label: "Gallery", href: "/gallery", crumb: "Component gallery", icon: <Palette strokeWidth={1.75} /> }];

/** `reviewCount`: runs this user can approve in the active project (the Reviews badge, PRD story 13). */
export function AppFrame({ user, reviewCount = 0, children }: { user: SessionUser; reviewCount?: number; children: React.ReactNode }) {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const { project, projects, setProjectId } = useProject();
  const switching = useNavigate();
  const signingOut = useNavigate();

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const toItem = (n: (typeof NAV)[number]): NavItem => ({
    label: n.label, icon: n.icon, href: n.href, badge: n.href === "/approvals" && reviewCount ? String(reviewCount) : n.badge, active: isActive(n.href),
  });
  const current = [...NAV, ...BOTTOM].find((n) => isActive(n.href));

  function switchProject(id: string) {
    if (id === project.id) return;
    const next = projects.find((p) => p.id === id);
    setProjectId(id);
    // A detail page (e.g. /runs/RUN-0421) belongs to the old project: go back to its list.
    // A list page just reloads its data for the new project.
    const sectionRoot = "/" + pathname.split("/")[1];
    if (pathname === sectionRoot) switching.refresh();
    else switching.push(sectionRoot);
    if (next) notify.info(`Switched to ${next.name}`);
  }

  return (
    <AppShell
      logo={{ light: "/arbiter-mark-light-bg.png", dark: "/arbiter-mark-dark-bg.png", alt: "Arbiter" }}
      nav={NAV.filter((n) => !n.roles || n.roles.includes(user.role)).map(toItem)}
      bottomNav={BOTTOM.map(toItem)}
      // The project is the first breadcrumb item (projectSwitcher); the trail starts at the section.
      breadcrumbs={current ? [current.crumb, ...pathname.split("/").slice(2).filter(Boolean).map((seg) => (seg === "new" ? "New run" : decodeURIComponent(seg)))] : []}
      projectSwitcher={
        <ProjectSwitcher
          projects={projects}
          activeId={project.id}
          onChange={switchProject}
          manageHref={user.role === "admin" ? "/admin" : undefined}
          pending={switching.pending}
        />
      }
      user={{ name: user.name, role: ROLE_LABEL[user.role], email: user.email }}
      theme={theme}
      onToggleTheme={toggle}
      onLogout={() => signingOut.run(() => signOut())}
      loggingOut={signingOut.pending}
    >
      {children}
    </AppShell>
  );
}
