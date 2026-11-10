import * as React from "react";
import { Inbox } from "lucide-react";

import { cn } from "@/lib/utils";

/* EmptyState: names the absence, offers the next step */

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-border-strong bg-accent p-10 text-center",
        className,
      )}
    >
      <div className="mb-3 flex size-10 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-sm [&_svg]:size-5">
        {icon ?? <Inbox />}
      </div>
      <div className="text-sm font-semibold">{title}</div>
      {description ? <p className="mt-1 max-w-80 text-xs text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
