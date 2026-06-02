import { cn } from "@/lib/utils";

// Stamp — Fraunces-typeset state label with a thin underline. For phase/
// status badges (ROUGH, CALIBRATING, STEADY). Never for numerics.

export function Stamp({
  children,
  tone = "muted",
  className,
}: {
  children: React.ReactNode;
  tone?: "default" | "lime" | "terracotta" | "rose" | "muted";
  className?: string;
}) {
  const colourClass =
    tone === "lime"
      ? "text-[oklch(0.85_0.18_120)]"
      : tone === "terracotta"
        ? "text-[oklch(0.7_0.13_45)]"
        : tone === "rose"
          ? "text-rose-500"
          : tone === "muted"
            ? "text-muted-foreground"
            : "text-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-0.5 border-b border-current/40 pb-px font-serif text-[10px] uppercase tracking-[0.2em]",
        colourClass,
        className,
      )}
    >
      {children}
    </span>
  );
}
