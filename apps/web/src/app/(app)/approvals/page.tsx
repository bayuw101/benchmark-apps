import type { Metadata } from "next";
import { Suspense } from "react";
import { Lock } from "lucide-react";

import { getSession } from "@/lib/auth/session";
import { activeProject } from "@/lib/server/projects";
import { approvalInbox } from "@/lib/server/approvals";
import { atLeast } from "@/lib/session";
import { EmptyState } from "@/components/arbiter/empty-state";
import { PageBody, PageShell } from "@/components/arbiter/page-shell";
import { ApprovalsView } from "@/components/approvals/approvals-view";

export const metadata: Metadata = { title: "Approvals · Benchmark" };

/** UI-08. Approvers and admins; the approve/reject APIs check the rules again. */
export default async function ApprovalsPage() {
  const user = await getSession();
  if (!user || !atLeast(user.role, "approver")) {
    return (
      <>
        <PageShell title="Approvals" />
        <PageBody>
          <EmptyState icon={<Lock />} title="Approvals are for approvers" description="Runs that need approval show their status on the Runs page. An admin can give you the approver role." />
        </PageBody>
      </>
    );
  }
  const { projectId, project } = await activeProject();
  return (
    <Suspense>
      <ApprovalsView items={await approvalInbox(user, projectId, new Date())} projectName={project?.name ?? ""} />
    </Suspense>
  );
}
