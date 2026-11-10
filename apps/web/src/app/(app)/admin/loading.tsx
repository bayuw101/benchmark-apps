import { Skeleton } from "@/components/ui/skeleton";
import { PageBody, PageShell } from "@/components/arbiter/page-shell";

export default function Loading() {
  return (
    <>
      <PageShell title="Admin" subtitle="Loading…" />
      <PageBody className="grid gap-4" aria-busy="true" aria-label="Loading admin">
        <Skeleton className="h-10" />
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-14" style={{ opacity: 1 - i * 0.15 }} />
        ))}
      </PageBody>
    </>
  );
}
