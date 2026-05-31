"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  extractVendorToken,
  groupSpendsByVendor,
  vendorIntelligence,
} from "@/lib/spending/vendor-extract";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode, Spend } from "@/lib/supabase/types";

interface VendorIntelligenceProps {
  spends: Spend[];
  baseCurrency: CurrencyCode;
}

interface VendorRow {
  vendor: string;
  slug: string;
  confidence: "known" | "guessed";
  count: number;
  total: number;
  lastSeenAt: string | null;
  avgTicket: number;
}

// URL-safe slug from a vendor display name. Lowercased, alnum-only, dashed.
function toSlug(vendor: string): string {
  return vendor
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function daysAgo(iso: string, now: number): number {
  const t = new Date(iso).getTime();
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

function formatLastSeen(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

export function VendorIntelligence({
  spends,
  baseCurrency,
}: VendorIntelligenceProps) {
  const rows = useMemo<VendorRow[]>(() => {
    const grouped = groupSpendsByVendor(spends);
    const out: VendorRow[] = [];
    for (const [vendor, vSpends] of grouped) {
      if (vendor === "—") continue;
      // Confidence is per-spend in extractVendorToken; reuse the first match
      // to decide how to render the vendor name (known vs. guessed).
      const sample = vSpends.find((s) => s.description);
      const conf = sample
        ? extractVendorToken(sample.description ?? "").confidence
        : null;
      if (!conf) continue;
      const intel = vendorIntelligence(spends, vendor);
      if (intel.count === 0) continue;
      out.push({
        vendor,
        slug: toSlug(vendor),
        confidence: conf,
        count: intel.count,
        total: intel.total,
        lastSeenAt: intel.lastSeenAt,
        avgTicket: intel.avgTicket,
      });
    }
    out.sort((a, b) => b.count - a.count || b.total - a.total);
    return out.slice(0, 6);
  }, [spends]);

  if (rows.length === 0) {
    return (
      <div className="px-4 py-6 text-[12px] leading-relaxed text-ink/55">
        No vendors learned yet — log a few spends with descriptions and
        they&apos;ll appear here.
      </div>
    );
  }

  const now = Date.now();

  return (
    <ul className="divide-y divide-ink/8">
      {rows.map((r) => {
        const lastLabel =
          r.lastSeenAt !== null ? formatLastSeen(daysAgo(r.lastSeenAt, now)) : "—";
        const visitsLabel = `${r.count} ${r.count === 1 ? "visit" : "visits"}`;
        const avgLabel = `avg ${formatMoney(r.avgTicket, baseCurrency, { compact: true })}`;
        return (
          <li key={r.slug}>
            <Link
              href={`/spending/vendor/${r.slug}`}
              className="flex h-11 items-center justify-between gap-3 px-4 transition-colors duration-300 hover:bg-ink/4"
            >
              <div className="min-w-0 flex-1">
                <div
                  className={
                    "truncate text-[13px] text-ink" +
                    (r.confidence === "guessed"
                      ? " decoration-dotted decoration-ink/40 underline-offset-4 [text-decoration-line:underline]"
                      : "")
                  }
                >
                  {r.vendor}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-ink/60">
                  {visitsLabel} <span className="text-ink/30">·</span> last{" "}
                  {lastLabel} <span className="text-ink/30">·</span> {avgLabel}
                </div>
              </div>
              <div className="tabular shrink-0 text-[13px] text-ink/85">
                {formatMoney(r.total, baseCurrency, { compact: true })}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
