"use client";

import { useState } from "react";
import { ExternalLink, SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/arbiter/empty-state";
import { PageBody, PageShell } from "@/components/arbiter/page-shell";
import { FoundationsSection } from "@/components/gallery/foundations";
import { ActionsSection } from "@/components/gallery/actions";
import { FieldsSection } from "@/components/gallery/fields";
import { PickersSection } from "@/components/gallery/pickers";
import { DataDisplaySection } from "@/components/gallery/data-display";
import { OverlaysSection } from "@/components/gallery/overlays";
import { BtbSection } from "@/components/gallery/btb";
import { ShellSection } from "@/components/gallery/shell-demo";

const DESIGN_SYSTEM_URL = "https://claude.ai/artifact/T35xtMeBuGZfyY4ohohNPR";

// Keywords make the header search find a section by the components inside it.
const SECTIONS = [
  { id: "foundations", label: "Foundations", keywords: "colour color token type typography radius radii shadow elevation spacing", Comp: FoundationsSection },
  { id: "actions", label: "Buttons and badges", keywords: "button badge status pill loading spinner", Comp: ActionsSection },
  { id: "fields", label: "Fields and forms", keywords: "input field select textarea form switch checkbox floating label error", Comp: FieldsSection },
  { id: "pickers", label: "Date and time", keywords: "date time picker calendar range datetime", Comp: PickersSection },
  { id: "display", label: "Data display", keywords: "metric card table datatable empty state skeleton search page header", Comp: DataDisplaySection },
  { id: "overlays", label: "Overlays and menus", keywords: "modal dialog confirm sheet row actions menu tabs toast tooltip", Comp: OverlaysSection },
  { id: "btb", label: "BTB components", keywords: "run status hash verdict policy violation preflight emergency stop threshold live chart", Comp: BtbSection },
  { id: "shell", label: "App shell", keywords: "shell sidebar topbar breadcrumb project switcher ai assistant chat navigation", Comp: ShellSection },
];

export default function GalleryPage() {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const shown = query ? SECTIONS.filter((s) => `${s.label} ${s.keywords}`.toLowerCase().includes(query)) : SECTIONS;
  const openDesignSystem = () => window.open(DESIGN_SYSTEM_URL, "_blank", "noopener,noreferrer");

  return (
    <>
      <PageShell
        title="Component gallery"
        subtitle={query ? `${shown.length} of ${SECTIONS.length} sections match “${q.trim()}”` : "Arbiter Benchmark UI on Tailwind + shadcn"}
        searchLabel="Search components"
        onSearch={setQ}
        action={<Button size="sm" icon={<ExternalLink />} onClick={openDesignSystem}>Open design system</Button>}
        onAction={openDesignSystem}
        actionIcon={<ExternalLink />}
        actionLabel="Open design system"
      />
      <PageBody className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_168px]">
        <div className="grid min-w-0 grid-cols-1 gap-12">
          {shown.length ? (
            shown.map(({ id, Comp }) => <Comp key={id} />)
          ) : (
            <EmptyState
              icon={<SearchX />}
              title="No components match"
              description={`Nothing in the gallery matches “${q.trim()}”. Try “button”, “picker” or “stop”.`}
            />
          )}
        </div>
        <nav aria-label="Gallery sections" className="max-lg:hidden">
          <div className="sticky top-20 grid gap-0.5 border-l border-border">
            {shown.map((t) => (
              <a
                key={t.id}
                href={`#${t.id}`}
                className="-ml-px border-l border-transparent py-1 pl-3 text-xs text-muted-foreground transition-colors duration-150 hover:border-foreground hover:text-foreground"
              >
                {t.label}
              </a>
            ))}
          </div>
        </nav>
      </PageBody>
    </>
  );
}
