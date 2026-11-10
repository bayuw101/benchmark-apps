import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Tone pairs are below 4.5:1 in the source, so a badge always carries its word.
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs leading-4 font-medium whitespace-nowrap [&_svg]:size-3",
  {
    variants: {
      tone: {
        neutral: "bg-muted text-muted-foreground",
        success: "bg-success-soft text-success",
        warning: "bg-warning-soft text-warning",
        danger: "bg-danger-soft text-danger",
        info: "bg-info-soft text-info",
        brand: "bg-brand text-white",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

type BadgeProps = React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    dot?: boolean;
    /** Pulse the dot (live states). */
    pulse?: boolean;
  };

function Badge({ className, tone, dot, pulse, children, ...props }: BadgeProps) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot ? (
        <span aria-hidden className={cn("size-1.5 rounded-full bg-current", pulse && "animate-live-pulse motion-reduce:animate-none")} />
      ) : null}
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
export type { BadgeProps };
