"use client";

import * as React from "react";
import { CircleCheck, CircleX, Info, Loader2, TriangleAlert } from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

// Arbiter Benchmark UI toast: card, hairline, 4px left border in the tone colour, rounded-xl, p-4, 360px.
// Shared with the static <Toast/> in components/arbiter/overlays.tsx.
export const toastBaseClass =
  "flex w-[360px] max-w-full items-start gap-3 rounded-xl border border-l-4 border-border bg-card p-4 text-foreground shadow-lg";
export const toastToneClass = {
  success: "border-l-success [&_[data-toast-icon]]:text-success",
  error: "border-l-danger [&_[data-toast-icon]]:text-danger",
  warning: "border-l-warning [&_[data-toast-icon]]:text-warning",
  info: "border-l-info [&_[data-toast-icon]]:text-info",
} as const;
export const toastIcons = {
  success: <CircleCheck data-toast-icon className="size-4" />,
  error: <CircleX data-toast-icon className="size-4" />,
  warning: <TriangleAlert data-toast-icon className="size-4" />,
  info: <Info data-toast-icon className="size-4" />,
} as const;

// The theme lives on <html data-theme>, not in a provider; follow it live.
function subscribe(onChange: () => void) {
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}
const getTheme = (): "light" | "dark" => (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");

function Toaster(props: ToasterProps) {
  const theme = React.useSyncExternalStore(subscribe, getTheme, () => "light" as const);
  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      icons={{ ...toastIcons, loading: <Loader2 className="size-4 animate-spin" /> }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: toastBaseClass,
          icon: "mt-0.5",
          title: "text-sm font-semibold",
          description: "mt-1 text-xs text-muted-foreground",
          success: toastToneClass.success,
          error: toastToneClass.error,
          warning: toastToneClass.warning,
          info: toastToneClass.info,
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
