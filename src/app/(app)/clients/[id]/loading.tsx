import { Skeleton } from "@/components/ui/skeleton";

export default function ClientDetailLoading() {
  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-8 lg:px-10 lg:py-12">
      <Skeleton className="h-4 w-20" />
      <div className="mt-5 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Skeleton className="h-10 w-64 max-w-full" />
          <Skeleton className="mt-3 h-4 w-40" />
          <Skeleton className="mt-3 h-5 w-80 max-w-full" />
        </div>
        <Skeleton className="h-9 w-24 shrink-0" />
      </div>
      <div className="mt-6 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-border/60">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-card px-4 py-4">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-6 w-20" />
          </div>
        ))}
      </div>
      <div className="mt-10 grid gap-10 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-3">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
