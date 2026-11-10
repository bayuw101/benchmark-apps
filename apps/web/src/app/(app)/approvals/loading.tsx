import { Skeleton } from "@/components/ui/skeleton";
import { PageBody, PageShell } from "@/components/arbiter/page-shell";

export default function Loading() {
  return (
    <>
      <PageShell title="Approvals" subtitle="Loading…" />
      <PageBody className="grid gap-3" aria-busy="true" aria-label="Loading approvals">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-20" style={{ opacity: 1 - i * 0.2 }} />
        ))}
      </PageBody>
    </>
  );
}
