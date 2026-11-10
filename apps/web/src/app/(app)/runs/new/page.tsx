import type { Metadata } from "next";
import { Suspense } from "react";

import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/session";
import { RunsView } from "@/components/runs/runs-view";
import { CreateRunSheet } from "./create-run-sheet";

export const metadata: Metadata = { title: "Create run · Benchmark" };

/**
 * /runs/new loaded directly (a shared link, a refresh, or a click before the app finished loading): the same
 * view as from inside the app, the Runs list with the Create run sheet open. Closing it goes to /runs.
 */
export default async function NewRunPage() {
  const user = await getSession();
  return (
    <>
      <Suspense>
        <RunsView canCreate={!!user && atLeast(user.role, "engineer")} />
      </Suspense>
      <CreateRunSheet direct />
    </>
  );
}
