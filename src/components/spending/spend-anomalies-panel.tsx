import Link from "next/link";
import type {
  SpendingAnomaly,
  SpendingAnomalyKind,
} from "@/lib/ai/spending-anomalies";

interface SpendAnomaliesPanelProps {
  anomalies: SpendingAnomaly[];
}

// Border-left accent per kind. Terracotta (--overdue) for spend pressure
// (spikes + pace), acid lime (--brand) for vendor-flavored signals, neutral
// ink for soft notes/dips.
const KIND_ACCENT: Record<SpendingAnomalyKind, string> = {
  category_spike: "border-l-[var(--overdue)]",
  pace_warning: "border-l-[var(--overdue)]",
  vendor_spike: "border-l-[color-mix(in_oklab,var(--brand)_70%,transparent)]",
  category_dip: "border-l-ink/25",
  note: "border-l-ink/20",
};

function vendorSlug(token: string): string {
  return token
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function anomalyHref(a: SpendingAnomaly): string | null {
  if (a.refCategoryId) return `/spending/category/${a.refCategoryId}`;
  if (a.refVendor) {
    const slug = vendorSlug(a.refVendor);
    return slug ? `/spending/vendor/${slug}` : null;
  }
  return null;
}

export function SpendAnomaliesPanel({ anomalies }: SpendAnomaliesPanelProps) {
  if (anomalies.length === 0) return null;

  return (
    <ul className="flex flex-col gap-2">
      {anomalies.slice(0, 3).map((a, i) => {
        const href = anomalyHref(a);
        const accent = KIND_ACCENT[a.kind];
        const body = (
          <>
            <div className="text-[13px] font-medium leading-snug text-ink">
              {a.title}
            </div>
            <div className="mt-0.5 text-[12px] leading-relaxed text-ink/70">
              {a.detail}
            </div>
          </>
        );
        const base =
          "block rounded-[10px] border-l-2 bg-paper px-3.5 py-2.5 " + accent;
        return (
          <li key={`${a.kind}-${i}`}>
            {href ? (
              <Link
                href={href}
                className={
                  base + " transition-colors duration-300 hover:bg-ink/[0.03]"
                }
              >
                {body}
              </Link>
            ) : (
              <div className={base}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
