import { Skeleton } from "@/components/ui/skeleton";

// Streamed while the per-metric server page resolves its query.
export default function MetricLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-8 lg:px-10 lg:py-12">
      <Skeleton className="h-4 w-28" />
      <div className="mt-6">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      </div>
      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <div className="mt-10 grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-80 lg:col-span-2" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}
