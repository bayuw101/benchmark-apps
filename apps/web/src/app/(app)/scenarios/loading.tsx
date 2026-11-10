import { Skeleton } from "@/components/ui/skeleton";
import { PageBody, PageShell } from "@/components/arbiter/page-shell";

/** Shown at once while the catalog page renders on the server. */
export default function Loading() {
  return (
    <>
      <PageShell title="Scenarios" />
      <PageBody
        className="grid gap-4"
        aria-busy="true"
        aria-label="Loading scenarios"
      >
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-10" />
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton
            key={i}
            className="h-14"
            style={{ opacity: 1 - i * 0.15 }}
          />
        ))}
      </PageBody>
    </>
  );
}
