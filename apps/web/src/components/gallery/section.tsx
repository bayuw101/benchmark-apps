import * as React from "react";
import { cn } from "@/lib/utils";

/** Gallery section wrapper: the same markup the other sections use. */
export function GallerySection({ id, title, description, children, className }: {
  id: string; title: string; description: string; children: React.ReactNode; className?: string;
}) {
  return (
    <section id={id} className={cn("grid scroll-mt-20 grid-cols-1 gap-4", className)}>
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

/** A labelled demo tile inside a section. */
export function Demo({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid content-start gap-3 rounded-lg border border-border bg-card p-4", className)}>
      <div className="text-label font-medium tracking-wide text-muted-foreground uppercase">{label}</div>
      {children}
    </div>
  );
}
