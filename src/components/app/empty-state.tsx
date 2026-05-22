import { cn } from "@/lib/utils";

// Editorial postcard, not a wizard. A quiet Fraunces line carries the moment;
// the icon is small and muted; the action is understated. Restraint = premium.
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
        "relative flex flex-col items-center justify-center rounded-[20px] border border-dashed border-border/70 bg-card/40 px-8 py-20 text-center",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 rounded-[20px] bg-grid opacity-50" />
      {Icon && (
        <div className="relative mb-5 grid h-11 w-11 place-items-center rounded-[10px] border border-border/70 bg-card text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <h3 className="display-headline relative text-2xl">{title}</h3>
      {description && (
        <p className="relative mt-2 max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="relative mt-7">{action}</div>}
    </div>
  );
}
