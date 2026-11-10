"use client";

import * as React from "react";

import { PROJECT_COOKIE, type Project } from "@/lib/projects";

interface ProjectContextValue {
  project: Project;
  projects: Project[];
  /** Writes the session cookie and updates state. The caller refreshes or navigates afterwards. */
  setProjectId: (id: string) => void;
}

const ProjectContext = React.createContext<ProjectContextValue | null>(null);

/** Active project for this session. `initialId` comes from the server (already validated) so the first paint is right. */
export function ProjectProvider({ initialId, projects, children }: { initialId: string; projects: Project[]; children: React.ReactNode }) {
  const [id, setId] = React.useState(initialId);
  const project = projects.find((p) => p.id === id) ?? projects[0];

  const value = React.useMemo<ProjectContextValue>(
    () => ({
      project,
      projects,
      setProjectId: (next) => {
        if (!projects.some((p) => p.id === next)) return;
        // Session cookie: no Max-Age/Expires. Readable by the server layout on the next request.
        const secure = location.protocol === "https:" ? "; Secure" : "";
        document.cookie = `${PROJECT_COOKIE}=${encodeURIComponent(next)}; Path=/; SameSite=Lax${secure}`;
        setId(next);
      },
    }),
    [project, projects],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject() {
  const ctx = React.useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used inside <ProjectProvider>");
  return ctx;
}
