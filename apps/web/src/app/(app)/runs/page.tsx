import type { Metadata } from "next";
import { Suspense } from "react";

import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/session";
import { RunsView } from "@/components/runs/runs-view";

export const metadata: Metadata = { title: "Runs · Benchmark" };

export default async function RunsPage() {
  // The layout already redirected anyone without a session; this decides the Create run button.
  // The server still re-checks the role when a run is created (UI-04 / E1.2).
  const user = await getSession();
  return (
    <Suspense>
      <RunsView canCreate={!!user && atLeast(user.role, "engineer")} />
    </Suspense>
  );
}
