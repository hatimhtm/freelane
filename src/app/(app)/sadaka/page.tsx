import { readPoolBalance, listLedgerEvents } from "@/lib/sadaka/ledger";
import { getSuggestedToday } from "@/lib/sadaka/suggestion";
import { listAutoRules } from "@/lib/sadaka/auto-rules";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import { getDashboardData } from "@/lib/data/queries";
import type { CurrencyCode } from "@/lib/supabase/types";

import { SadakaPoolHero } from "./_components/sadaka-pool-hero";
import { SadakaActivity } from "./_components/sadaka-activity";
import { SadakaRhythm } from "./_components/sadaka-rhythm";
import { SadakaAutoRules } from "./_components/sadaka-auto-rules";

export const metadata = { title: "Sadaka" };

export default async function SadakaPage() {
  // Fan-out is intentionally serial-tolerant — every reader is best-effort
  // and falls back to a calm default if the table is missing.
  const [pool, events, suggestion, rules, dash] = await Promise.all([
    readPoolBalance(),
    listLedgerEvents(20),
    getSuggestedToday(),
    listAutoRules(),
    getDashboardData(),
  ]);

  const currency = (dash.settings?.base_currency ?? BASE_CURRENCY_FALLBACK) as CurrencyCode;
  // Holdings — for the hero's "Mark sadaka given" CTA so the user can pick a
  // wallet to mirror the payment outflow against. The picker reads the
  // standard methods list.
  const wallets = dash.methods
    .filter((m) => !m.archived && m.is_holding)
    .map((m) => ({ id: m.id, name: m.name }));

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 md:px-6">
      <header className="space-y-1">
        <h1 className="display-headline text-3xl text-foreground">Sadaka</h1>
        <p className="text-[12.5px] leading-snug text-muted-foreground">
          A reserve pool for voluntary giving. Pool sits at {Math.round(pool.displayBase)}.
        </p>
      </header>

      <SadakaPoolHero
        poolBase={pool.displayBase}
        suggestedToday={suggestion.suggested_amount}
        suggestedReasoning={suggestion.reasoning}
        currency={currency}
        wallets={wallets}
      />

      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <SadakaActivity events={events} currency={currency} />
        <SadakaRhythm events={events} currency={currency} />
        <SadakaAutoRules initialRules={rules} />
      </section>
    </div>
  );
}
