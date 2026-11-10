import { CreateRunForm, CreateRunSheetMessage } from "@/components/runs/create-run-form";
import { BLOCKED_COPY, loadCreateRun } from "./load";

/** The Create run sheet, shared by the in-app route (`@sheet/(.)new`) and a direct load of /runs/new. */
export async function CreateRunSheet({ direct }: { direct?: boolean }) {
  const { project, catalog, state } = await loadCreateRun();
  if (state !== "ok" || !project) return <CreateRunSheetMessage projectName={project?.name ?? ""} direct={direct} {...BLOCKED_COPY[state === "ok" ? "not-ready" : state]} />;
  return <CreateRunForm key={project.id} catalog={catalog} projectName={project.name} direct={direct} />;
}
