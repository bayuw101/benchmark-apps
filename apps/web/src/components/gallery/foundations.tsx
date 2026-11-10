import { GallerySection } from "./section";

const COLORS: { group: string; tokens: { name: string; usage: string }[] }[] = [
  {
    group: "Surfaces",
    tokens: [
      { name: "background", usage: "Page ground behind cards" },
      { name: "card", usage: "Raised surfaces, inputs" },
      { name: "muted", usage: "Table header, hover fills" },
      { name: "accent", usage: "Sunken wells, EmptyState" },
      { name: "border", usage: "Default hairline" },
      { name: "border-strong", usage: "Dashed outlines, separators" },
    ],
  },
  {
    group: "Text and action",
    tokens: [
      { name: "foreground", usage: "Primary text" },
      { name: "muted-foreground", usage: "Descriptions, inactive" },
      { name: "secondary-foreground", usage: "Whisper only, below AA" },
      { name: "primary", usage: "Black. Primary buttons" },
      { name: "brand", usage: "Blue accent, once per page" },
      { name: "field-focus", usage: "Focused field border" },
    ],
  },
  {
    group: "Shell",
    tokens: [
      { name: "shell", usage: "App frame ground" },
      { name: "shell-foreground", usage: "Active icon, user name" },
      { name: "shell-muted", usage: "Inactive tiles, crumbs" },
      { name: "shell-border", usage: "Topbar divider" },
      { name: "shell-active", usage: "Toggle on-state" },
      { name: "overlay", usage: "Dialog scrim" },
    ],
  },
  {
    group: "Status (always with a word or icon)",
    tokens: [
      { name: "success", usage: "Completed, pass" },
      { name: "warning", usage: "Pending, queued" },
      { name: "danger", usage: "Failed, destructive" },
      { name: "info", usage: "Approved, live" },
      { name: "success-soft", usage: "Success badge ground" },
      { name: "danger-soft", usage: "Danger badge ground" },
    ],
  },
];

const TYPE = [
  { name: "metric", cls: "text-2xl leading-8 font-semibold tabular-nums", sample: "1,284", spec: "24 / 32 · 600" },
  { name: "page-title", cls: "text-lg leading-7 font-semibold", sample: "Run results", spec: "18 / 28 · 600" },
  { name: "dialog-title", cls: "text-base leading-6 font-semibold", sample: "Stop this run?", spec: "16 / 24 · 600" },
  { name: "body", cls: "text-sm", sample: "p95 stayed under the threshold for the whole window.", spec: "14 / 21 · 400" },
  { name: "body-strong", cls: "text-sm font-semibold", sample: "Load profile", spec: "14 / 20 · 600" },
  { name: "small", cls: "text-xs font-medium", sample: "Updated 2 min ago", spec: "12 / 16 · 500" },
  { name: "micro", cls: "text-micro font-medium", sample: "Enter a target hostname", spec: "11 / 16 · 500" },
  { name: "label-float", cls: "text-label font-medium", sample: "Release ID", spec: "10 / 14 · 500" },
  { name: "data-mono", cls: "font-mono text-xs font-medium", sample: "RUN-2026-0418", spec: "12 / 16 · mono" },
];

const RADII = [
  { name: "radius-sm · rounded-md", cls: "rounded-md", px: "6px" },
  { name: "radius-md · rounded-lg", cls: "rounded-lg", px: "8px" },
  { name: "radius-nav", cls: "rounded-nav", px: "9px" },
  { name: "radius-lg · rounded-xl", cls: "rounded-xl", px: "12px" },
  { name: "radius-xl · rounded-2xl", cls: "rounded-2xl", px: "16px" },
];

const ELEVATION = [
  { name: "Flat", cls: "border border-border", usage: "Tables, fields" },
  { name: "Raised · shadow-sm", cls: "border border-border shadow-sm", usage: "Cards, primary button" },
  { name: "Floating · shadow-lg", cls: "border border-border shadow-lg", usage: "Menus, popovers" },
  { name: "Top · shadow-xl", cls: "border border-border shadow-xl", usage: "Dialogs, sheets" },
];

export function FoundationsSection() {
  return (
    <GallerySection id="foundations" title="Foundations" description="Tokens from Arbiter Benchmark UI. Every colour is a CSS variable with light and dark values; toggle the theme in the top bar.">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {COLORS.map((g) => (
          <div key={g.group} className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 text-xs font-semibold">{g.group}</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              {g.tokens.map((t) => (
                <div key={t.name} className="flex min-w-0 items-center gap-2.5">
                  <span className="size-8 shrink-0 rounded-lg border border-border" style={{ background: `var(--${t.name})` }} />
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-xs font-medium">{t.name}</span>
                    <span className="block truncate text-label text-muted-foreground">{t.usage}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="rounded-lg border border-border bg-card">
          {TYPE.map((t) => (
            <div key={t.name} className="flex items-baseline gap-4 border-b border-border px-4 py-3 last:border-0">
              <span className="w-24 shrink-0 font-mono text-label text-muted-foreground">{t.name}</span>
              <span className={`min-w-0 flex-1 truncate ${t.cls}`}>{t.sample}</span>
              <span className="shrink-0 text-label text-muted-foreground max-sm:hidden">{t.spec}</span>
            </div>
          ))}
        </div>
        <div className="grid content-start gap-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 text-xs font-semibold">Radii</div>
            <div className="flex flex-wrap gap-3">
              {RADII.map((r) => (
                <div key={r.name} className="grid justify-items-center gap-1.5">
                  <span className={`size-12 border border-border-strong bg-muted ${r.cls}`} />
                  <span className="text-label text-muted-foreground">{r.px}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg bg-accent p-4">
            <div className="mb-3 text-xs font-semibold">Elevation</div>
            <div className="grid grid-cols-2 gap-3">
              {ELEVATION.map((e) => (
                <div key={e.name} className={`rounded-lg bg-card p-3 ${e.cls}`}>
                  <div className="text-xs font-medium">{e.name}</div>
                  <div className="text-label text-muted-foreground">{e.usage}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </GallerySection>
  );
}
