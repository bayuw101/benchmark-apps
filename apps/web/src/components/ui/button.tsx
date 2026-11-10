import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

// Restyled to Arbiter Benchmark UI: black primary (never blue), 32/36/44px heights,
// semibold 12px labels, press scale, focus ring = card gap + 2px brand.
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-transparent font-semibold whitespace-nowrap transition-[background-color,color,opacity,transform,box-shadow] duration-150 outline-none active:scale-[0.97] focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground shadow-sm hover:opacity-90",
        secondary: "bg-muted text-foreground hover:bg-border",
        outline: "border-border bg-card text-foreground hover:bg-muted",
        ghost: "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
        danger: "bg-danger text-white shadow-sm hover:opacity-90",
        link: "h-auto border-0 p-0 text-brand underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-9 px-4 text-xs",
        lg: "h-11 gap-2 px-5 text-sm [&_svg:not([class*='size-'])]:size-4",
        icon: "size-8 p-0 [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent", className)}
    />
  );
}

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    /** Disables the button and swaps the icon for a spinner. Required on every async action. */
    loading?: boolean;
    /** Leading icon. Every button has one (design system rule). */
    icon?: React.ReactNode;
  };

function Button({ className, variant, size, asChild = false, loading, icon, disabled, children, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <Spinner /> : icon}
          {children}
        </>
      )}
    </Comp>
  );
}

export { Button, buttonVariants, Spinner };
export type { ButtonProps };
