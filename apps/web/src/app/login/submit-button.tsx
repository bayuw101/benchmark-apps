"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

/** Disables itself and shows the spinner while the sign-in action runs (design system: every async action). */
export function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="lg"
      loading={pending}
      // eslint-disable-next-line @next/next/no-img-element -- static brand mark from /public
      icon={<img src="/microsoft-logo.svg" alt="" width={16} height={16} className="size-4" />}
      className="w-full"
    >
      {pending ? "Signing in…" : children}
    </Button>
  );
}
