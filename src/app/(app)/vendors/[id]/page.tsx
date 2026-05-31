import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getVendorDetail } from "@/lib/data/queries";
import { vendorHeartbeat } from "@/lib/ai/vendor-heartbeat";
import { priceDriftReads } from "@/lib/ai/price-drift";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode } from "@/lib/supabase/types";

export const metadata = { title: "Vendor" };

export default async function VendorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { vendor, aliases, links, spends, items, settings } = await getVendorDetail(id);
  if (!vendor) notFound();
  const baseCurrency = (settings?.base_currency ?? BASE_CURRENCY_FALLBACK) as CurrencyCode;
  const now = new Date();

  const heartbeat = vendorHeartbeat(vendor, links, spends, now);
  const myLinkIds = new Set(links.map((l) => l.spend_id));
  const mySpends = spends.filter((s) => myLinkIds.has(s.id)).sort((a, b) => b.spent_at.localeCompare(a.spent_at));
  const myItems = items.filter((it) => myLinkIds.has(it.spend_id));
  const drift = priceDriftReads(myItems, mySpends, links).filter((d) => d.vendorId === vendor.id);

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-5 p-4 sm:p-6">
      <Link
        href="/vendors"
        className="inline-flex items-baseline gap-1 self-start text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        Vendors
      </Link>

      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border/40 pb-3">
        <div>
          <h1 className="font-display text-xl leading-tight">{vendor.canonical_name}</h1>
          {vendor.short_description && (
            <p className="text-xs text-muted-foreground">{vendor.short_description}</p>
          )}
        </div>
        <div className="text-right">
          <div className="font-display tabular text-base">
            {formatMoney(heartbeat.recentSpendBase, baseCurrency, { compact: true })}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            last 30 days · {heartbeat.recentVisits} visits
          </div>
        </div>
      </header>

      {/* Heartbeat panel */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total spends" value={mySpends.length} baseCurrency={baseCurrency} raw />
        <Stat
          label="Lifetime ₱"
          value={mySpends.reduce((s, sp) => s + Number(sp.amount_base ?? 0), 0)}
          baseCurrency={baseCurrency}
        />
        <Stat
          label="Avg ticket"
          value={mySpends.length ? mySpends.reduce((s, sp) => s + Number(sp.amount_base ?? 0), 0) / mySpends.length : 0}
          baseCurrency={baseCurrency}
        />
        <Stat
          label="Last seen"
          value={vendor.last_seen_at ?? "—"}
          baseCurrency={baseCurrency}
          raw
        />
      </section>

      {/* Aliases */}
      {aliases.length > 0 && (
        <section className="flex flex-wrap items-baseline gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Aliases</span>
          {aliases.map((a) => (
            <span
              key={a.id}
              className="rounded-full border border-border/70 bg-muted/30 px-2 py-0.5 text-[11px] text-foreground/80"
            >
              {a.alias}
            </span>
          ))}
        </section>
      )}

      {/* Price drift */}
      {drift.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-sm font-medium">Price drift</h2>
          <ul className="flex flex-col divide-y divide-border/40 rounded-[10px] border border-border/50 bg-card/30">
            {drift.slice(0, 8).map((d) => (
              <li key={d.itemNameNorm} className="grid grid-cols-[1fr_auto] items-baseline gap-3 px-3 py-2 text-[12px]">
                <span className="capitalize">{d.itemNameNorm}</span>
                <span className={`tabular ${d.trend === "rising" ? "text-overdue" : d.trend === "falling" ? "text-acid-lime" : "text-muted-foreground"}`}>
                  {formatMoney(d.firstPriceBase, baseCurrency, { compact: true })} → {formatMoney(d.lastPriceBase, baseCurrency, { compact: true })} ({d.pctChange >= 0 ? "+" : ""}{d.pctChange.toFixed(0)}%)
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Spend history */}
      <section className="flex flex-col gap-2">
        <h2 className="font-display text-sm font-medium">Recent spends</h2>
        {mySpends.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No spends linked yet. Tag a spend with this vendor and it will appear here.
          </p>
        )}
        <ul className="flex flex-col divide-y divide-border/40 rounded-[10px] border border-border/50 bg-card/30">
          {mySpends.slice(0, 30).map((sp) => (
            <li key={sp.id} className="grid grid-cols-[1fr_auto] items-baseline gap-3 px-3 py-2 text-[12px]">
              <div className="min-w-0">
                <div className="truncate">{sp.description ?? "—"}</div>
                <div className="text-[10px] text-muted-foreground">
                  {sp.spent_at}
                  {sp.spent_time && ` · ${sp.spent_time.slice(0, 5)}`}
                  {sp.for_us && " · for us"}
                </div>
              </div>
              <div className="font-display tabular">
                {formatMoney(Number(sp.amount_base ?? 0), baseCurrency, { compact: true })}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Notes */}
      {vendor.notes && (
        <section className="rounded-[12px] border border-border/40 bg-muted/20 p-3 text-[12px] leading-relaxed text-foreground/80">
          {vendor.notes}
        </section>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  baseCurrency,
  raw,
}: {
  label: string;
  value: number | string;
  baseCurrency: CurrencyCode;
  raw?: boolean;
}) {
  return (
    <div className="rounded-[10px] border border-border/60 bg-card/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-display tabular text-sm">
        {raw ? value : formatMoney(typeof value === "number" ? value : 0, baseCurrency, { compact: true })}
      </div>
    </div>
  );
}
