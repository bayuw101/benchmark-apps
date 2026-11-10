import { redirect } from "next/navigation";

import { AppFrame } from "@/components/app-frame";
import { NavigationProvider } from "@/components/navigation";
import { ProjectProvider } from "@/components/project-provider";
import { QueryProvider } from "@/components/query-provider";
import { getSession } from "@/lib/auth/session";
import { reviewCount as countReviews } from "@/lib/server/approvals";
import { activeProject } from "@/lib/server/projects";

// Everything behind sign-in renders per request: never prerender a page (or a redirect) at build time.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Middleware only checks that a session cookie exists; its value is validated here.
  const user = await getSession();
  if (!user) redirect("/login");

  // Validated here, so the first paint already shows the right project and nothing flickers.
  const { projects, projectId: initialId } = await activeProject();
  // Re-computed on every request and refresh, so approving a run updates the badge.
  const reviewCount = await countReviews(user, initialId, new Date());
  return (
    <QueryProvider>
      <ProjectProvider initialId={initialId} projects={projects}>
        <NavigationProvider>
          <AppFrame user={user} reviewCount={reviewCount}>
            {children}
          </AppFrame>
        </NavigationProvider>
      </ProjectProvider>
    </QueryProvider>
  );
}
