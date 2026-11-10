import { cn } from "@/lib/utils"

// `muted` was invisible on cards in dark mode (1.07:1). border / border-strong are the first
// tokens that read as a placeholder in each theme (1.24:1 light, 1.65:1 dark on card).
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn("animate-pulse rounded-lg bg-border motion-reduce:animate-none dark:bg-border-strong", className)}
      {...props}
    />
  )
}

export { Skeleton }
