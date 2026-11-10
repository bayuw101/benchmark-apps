"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/** One QueryClient per browser session (PRD A4: TanStack Query for history). */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: false, retry: 1 } } }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
