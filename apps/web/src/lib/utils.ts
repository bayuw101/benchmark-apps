import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge the design system's custom font sizes (text-micro 11px, text-label 10px).
// Without this it reads them as colours and drops text-muted-foreground etc.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["micro", "label"] }],
      shadow: [{ shadow: ["focus"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
