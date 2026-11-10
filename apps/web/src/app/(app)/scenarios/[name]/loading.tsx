import { Skeleton } from "@/components/ui/skeleton";
import { PageBody, PageShell } from "@/components/arbiter/page-shell";

/** Shown at once while a scenario renders on the server. */
export default function Loading() {
  return (
    <>
      <PageShell
        backHref="/scenarios"
        backLabel="Back to scenarios"
        title="Scenario"
        subtitle="Loading…"
      />
      <PageBody
        className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]"
        aria-busy="true"
        aria-label="Loading scenario"
      >
        <Skeleton className="h-[28rem]" />
        <Skeleton className="h-72" />
      </PageBody>
    </>
  );
}
