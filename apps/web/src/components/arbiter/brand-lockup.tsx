import { cn } from "@/lib/utils";

// The mark PNGs are 1201 × 1051 with 46px of transparent padding at top and bottom.
const MARK_RATIO = 1201 / 1051;
const MARK_PAD_Y = 46 / 1051;

/**
 * Arbiter mark + "Arbiter" (the mark is symbol-only, so the name sits beside it).
 * The name is bottom-aligned: its baseline sits exactly on the visible bottom of the mark, and
 * all spare height is above the text (never vertically centred).
 */
export function BrandLockup({
  height = 30,
  className,
  textClassName = "text-2xl font-semibold tracking-tight",
}: {
  /** Mark height in px. */
  height?: number;
  className?: string;
  textClassName?: string;
}) {
  const width = Math.round(height * MARK_RATIO);
  const markClass = "block shrink-0";
  return (
    <div className={cn("flex items-end gap-2", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny static marks, theme-swapped by CSS */}
      <img src="/arbiter-mark-light-bg.png" alt="" width={width} height={height} className={cn(markClass, "dark:hidden")} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/arbiter-mark-dark-bg.png" alt="" width={width} height={height} className={cn(markClass, "hidden dark:block")} />
      <span
        // text-box trims the line box to cap-height…baseline, so "bottom" means the baseline, not the descender space.
        className={cn("leading-none [text-box:trim-both_cap_alphabetic]", textClassName)}
        // Lift the baseline by the mark's transparent bottom padding, onto its visible bottom edge.
        style={{ marginBottom: height * MARK_PAD_Y }}
      >
        Arbiter
      </span>
    </div>
  );
}
