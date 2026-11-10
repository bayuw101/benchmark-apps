import * as React from "react";

/* FormSection: card, p-5 max, fields gap-3 */

export function FormSection({ title, description, actions, children }: { title: string; description?: string; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {actions}
      </div>
      <div className="mt-4 grid gap-3">{children}</div>
    </section>
  );
}
