import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-card/40 px-8 py-16 text-center",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 rounded-2xl bg-grid opacity-40" />
      {Icon && (
        <div className="relative mb-4 grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-[var(--brand)] to-[#5b9dff] text-white shadow-lg shadow-black/20">
          <Icon className="h-6 w-6" />
        </div>
      )}
      <h3 className="relative text-lg font-semibold tracking-tight">{title}</h3>
      {description && (
        <p className="relative mt-1.5 max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="relative mt-6">{action}</div>}
    </div>
  );
}
