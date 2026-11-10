import type { Metadata } from "next";

import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/session";
import { getCatalog } from "@/lib/server/catalog";
import { getRun } from "@/lib/server/runs";
import { RunDetailView } from "@/components/runs/run-detail-view";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `${decodeURIComponent((await params).id)} · Benchmark` };
}

/** UI-05. The role decides whether Start/Edit show; the API re-checks both. The catalog is for Edit. */
export default async function RunDetailPage({ params }: Props) {
  const id = decodeURIComponent((await params).id);
  const user = await getSession();
  const run = await getRun(id);
  return <RunDetailView id={id} canAct={!!user && atLeast(user.role, "engineer")} catalog={await getCatalog(run?.projectId ?? "")} />;
}
