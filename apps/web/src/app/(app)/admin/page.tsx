import type { Metadata } from "next";
import { Suspense } from "react";
import { Lock } from "lucide-react";

import { getSession } from "@/lib/auth/session";
import { loadAdmin } from "@/lib/server/admin-data";
import { activeProject } from "@/lib/server/projects";
import { EmptyState } from "@/components/arbiter/empty-state";
import { PageBody, PageShell } from "@/components/arbiter/page-shell";
import { AdminView } from "@/components/admin/admin-view";

export const metadata: Metadata = { title: "Admin · Benchmark" };

/** UI-07. Admins only: the nav hides Admin for others, and this page and every admin API check again. */
export default async function AdminPage() {
  const user = await getSession();
  if (!user || user.role !== "admin") {
    return (
      <>
        <PageShell title="Admin" />
        <PageBody>
          <EmptyState icon={<Lock />} title="Admin is for admins" description="Projects, targets, people and test data are managed by Benchmark admins. Ask one if something needs changing." />
        </PageBody>
      </>
    );
  }

  const { projectId } = await activeProject();
  const data = await loadAdmin(projectId);
  return (
    <Suspense>
      <AdminView me={user.id} projectId={projectId} {...data} />
    </Suspense>
  );
}
