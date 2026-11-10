"use client";

import * as React from "react";
import { useLinkStatus } from "next/link";

import { Spinner } from "@/components/ui/button";

/**
 * Inside a next/link <Link>: shows a spinner while that link's navigation is pending, otherwise `children`
 * (usually the link's icon, so the spinner takes its place). Without children it shows nothing until pending.
 */
export function LinkPending({ children, className }: { children?: React.ReactNode; className?: string }) {
  const { pending } = useLinkStatus();
  return pending ? <Spinner className={className} /> : <>{children}</>;
}
