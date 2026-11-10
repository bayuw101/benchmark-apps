import type { Metadata } from "next";

import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/session";
import { journeyOf } from "@/lib/runs/catalog";
import { getCatalog } from "@/lib/server/catalog";
import { activeProject } from "@/lib/server/projects";
import { ScenarioDetailView } from "@/components/catalog/scenario-detail-view";

type Props = { params: Promise<{ name: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return {
    title: `${decodeURIComponent((await params).name)} · Scenarios · Benchmark`,
  };
}

/** UI-06 scenario detail. Scenarios belong to the active project; another project's name shows "not here". */
export default async function ScenarioPage({ params }: Props) {
  const name = decodeURIComponent((await params).name);
  const user = await getSession();
  const { projectId, project } = await activeProject();
  const catalog = await getCatalog(projectId);
  const scenario = catalog.scenarios.find((s) => s.name === name) ?? null;
  return (
    <ScenarioDetailView
      key={scenario?.name ?? name}
      name={name}
      scenario={scenario}
      journey={scenario ? (journeyOf(catalog, scenario.journey) ?? null) : null}
      catalog={catalog}
      projectName={project?.name ?? ""}
      canEdit={!!user && atLeast(user.role, "engineer")}
    />
  );
}
