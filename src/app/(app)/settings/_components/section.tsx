// Shared Section wrapper for the Settings tree. Three previous pages
// (landing, notifications, updates) declared the exact same local helper —
// this extraction is the single source of truth so any future visual tweak
// (border tone, padding rhythm, header weight) lands everywhere at once.

export function Section({
  id,
  title,
  hint,
  action,
  children,
}: {
  id?: string;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="rounded-2xl border border-border/60 bg-card p-6"
    >
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {hint && (
            <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
