"use client";

import { useState } from "react";
import { Bell, Gauge, Layers, Plus, Settings, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AIChatPanel } from "@/components/arbiter/ai-chat-panel";
import { AppShell } from "@/components/arbiter/app-shell";
import { MetricCard } from "@/components/arbiter/metric-card";
import { PageShell } from "@/components/arbiter/page-shell";
import { ProjectSwitcher } from "@/components/btb/project-switcher";
import type { Project } from "@/lib/projects";
import { useTheme } from "@/lib/use-theme";
import { GallerySection } from "./section";

const MOCK_PROJECTS: Project[] = [
  { id: "ticketing", name: "Ticketing", description: "Checkout and seat holds" },
  { id: "payments", name: "Payments", description: "Card and wallet flows" },
];

export function ShellSection() {
  const { theme, toggle } = useTheme();
  const [ai, setAi] = useState(false);
  const [projectId, setProjectId] = useState(MOCK_PROJECTS[0].id);
  return (
    <GallerySection id="shell" title="App shell" description="80px sidebar of labelled tiles, 60px top bar, floating content card. The AI panel pushes the card instead of covering it. Below 768px the sidebar becomes a bottom nav.">
      <div className="h-[560px] overflow-hidden rounded-xl border border-border">
        <AppShell
          contained
          logo={{ light: "/arbiter-mark-light-bg.png", dark: "/arbiter-mark-dark-bg.png" }}
          nav={[
            { label: "Runs", icon: <Gauge strokeWidth={1.75} />, active: true },
            { label: "Reviews", icon: <ShieldCheck strokeWidth={1.75} />, badge: "3" },
            { label: "Catalog", icon: <Layers strokeWidth={1.75} /> },
            { label: "Admin", icon: <Settings strokeWidth={1.75} /> },
          ]}
          bottomNav={[{ label: "Alerts", icon: <Bell strokeWidth={1.75} /> }]}
          breadcrumbs={["Runs", "RUN-0421", "Results", "Browser metrics"]}
          projectSwitcher={<ProjectSwitcher projects={MOCK_PROJECTS} activeId={projectId} onChange={setProjectId} manageHref="/admin" />}
          user={{ name: "Bayu Wicaksono", role: "Engineer", email: "bayu.wicaksono@arbitersports.com" }}
          theme={theme}
          onToggleTheme={toggle}
          aiOpen={ai}
          onToggleAI={() => setAi(!ai)}
          aiPanel={
            ai ? (
              <AIChatPanel
                title="Assistant"
                model="Fast"
                suggestions={["Why did RUN-0418 abort?", "Compare p95 with the last baseline"]}
                onClose={() => setAi(false)}
              />
            ) : null
          }
        >
          <PageShell title="Runs" subtitle="Load tests against approved targets" onSearch={() => {}} searchLabel="Search runs" action={<Button size="sm" icon={<Plus />}>Create run</Button>} onAction={() => {}} />
          <div className="grid grid-cols-1 gap-2 p-5 sm:grid-cols-3">
            <MetricCard label="Runs this week" value="14" />
            <MetricCard label="Pending approval" value="3" />
            <MetricCard label="Pass rate" value="86%" />
          </div>
        </AppShell>
      </div>
    </GallerySection>
  );
}
