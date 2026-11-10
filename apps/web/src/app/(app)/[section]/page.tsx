import { notFound } from "next/navigation";
import { Clock } from "lucide-react";
import { EmptyState } from "@/components/arbiter/empty-state";
import { PageBody, PageShell } from "@/components/arbiter/page-shell";

// one placeholder for sections not built yet; each gets its own page in its story.
// Every nav section has its own page now (UI-08 was the last); add an entry here for the next unbuilt one.
const SECTIONS: Record<string, { title: string; story: string }> = {};

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const s = SECTIONS[(await params).section];
  if (!s) notFound();
  return (
    <>
      <PageShell title={s.title} />
      <PageBody>
        <EmptyState icon={<Clock />} title="Not built yet" description={`This page arrives with ${s.story}.`} />
      </PageBody>
    </>
  );
}
