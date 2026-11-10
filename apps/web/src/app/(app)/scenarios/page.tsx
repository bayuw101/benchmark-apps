import type { Metadata } from "next";
import { Suspense } from "react";

import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/session";
import { getCatalog } from "@/lib/server/catalog";
import { activeProject } from "@/lib/server/projects";
import { ScenariosView } from "@/components/catalog/scenarios-view";

export const metadata: Metadata = { title: "Scenarios · Benchmark" };

/** UI-06. Everyone can read the catalog; engineers and above save scenarios (the API re-checks). */
export default async function ScenariosPage() {
  const user = await getSession();
  const { projectId, project } = await activeProject();
  const catalog = await getCatalog(projectId);
  return (
    <Suspense>
      <ScenariosView
        catalog={catalog}
        journeys={catalog.journeys}
        image={catalog.image}
        projectName={project?.name ?? ""}
        canEdit={!!user && atLeast(user.role, "engineer")}
      />
    </Suspense>
  );
}
