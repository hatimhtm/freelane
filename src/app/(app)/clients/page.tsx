import { Users } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import {
  getClients,
  getOpenQuietChannels,
  getOpenClientPatternChangeMap,
} from "@/lib/data/queries";
import { createClient as createSupabase } from "@/lib/supabase/server";
import { toBase } from "@/lib/money";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import type { CurrencyCode, ExchangeRate } from "@/lib/supabase/types";
import { ClientList, ClientNewButton } from "./_components/client-list";

export const metadata = { title: "Clients" };

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const params = await searchParams;
  const clients = await getClients();

  const supabase = await createSupabase();
  const [projectsRes, paymentsRes, ratesRes, settingsRes, patternMap, quietChannels] =
    await Promise.all([
      supabase.from("projects").select("id,client_id,amount,currency,status"),
      supabase.from("payments").select("project_id,currency,net_amount_base,paid_at,implied_fee_base"),
      supabase.from("exchange_rates").select("code,rate_to_base"),
      supabase.from("settings").select("base_currency").maybeSingle(),
      // Single batched query for "is there an open client_pattern_change
      // notification for this client?" — per-card querying would be N+1.
      getOpenClientPatternChangeMap().catch(() => new Map<string, string>()),
      // Reuse the existing Tier 5 QuietChannel surface for the quiet_14d
      // warning pill. getOpenQuietChannels already filters resolved_at,
      // so we just bucket by client_id.
      getOpenQuietChannels(50).catch(() => []),
    ]);
  const projects = projectsRes.data ?? [];
  const payments = paymentsRes.data ?? [];
  const rates = (ratesRes.data ?? []) as Pick<ExchangeRate, "code" | "rate_to_base">[];
  const baseCurrency = (settingsRes.data?.base_currency ?? BASE_CURRENCY_FALLBACK) as CurrencyCode;
  const quietByClient = new Set<string>(
    (quietChannels ?? [])
      .map((q) => q.client_id as string | null)
      .filter((id): id is string => !!id),
  );

  const enriched = clients.map((c) => {
    const clientProjects = projects.filter((p) => p.client_id === c.id);
    const projectIds = new Set(clientProjects.map((p) => p.id));
    const clientPayments = payments.filter((p) => projectIds.has(p.project_id));

    // Landed total in base PHP — comparable across clients regardless of currency.
    const paidBase = clientPayments.reduce((s, p) => s + Number(p.net_amount_base ?? 0), 0);
    const feesBase = clientPayments.reduce((s, p) => s + Number(p.implied_fee_base ?? 0), 0);

    // Outstanding in base: open projects' (amount − same-currency payments) × rate.
    // Payments here are tracked in base, so for outstanding we approximate from
    // project amount minus base-converted landed (good enough for the card).
    const outstandingBase = clientProjects
      .filter((p) => p.status === "unpaid" || p.status === "partially_paid")
      .reduce((s, p) => {
        const projBase = toBase(Number(p.amount), p.currency as CurrencyCode, rates);
        const landed = payments
          .filter((pay) => pay.project_id === p.id)
          .reduce((acc, pay) => acc + Number(pay.net_amount_base ?? 0), 0);
        return s + Math.max(0, projBase - landed);
      }, 0);

    const lastPaidAt = clientPayments
      .map((p) => p.paid_at as string | null)
      .filter(Boolean)
      .sort()
      .pop() ?? null;

    return {
      ...c,
      projectCount: clientProjects.length,
      openCount: clientProjects.filter((p) => p.status === "unpaid" || p.status === "partially_paid").length,
      paidBase: Math.round(paidBase),
      feesBase: Math.round(feesBase),
      outstandingBase: Math.round(outstandingBase),
      lastPaidAt,
      hasMemory: !!(c.memory_consolidated?.summary || (c.memory_consolidated?.facts?.length ?? 0) > 0),
      // AI "watch" flags (the red ones) make the best at-a-glance tags; fall
      // back to a fact so a card with memory always shows a little context.
      watch: (c.memory_consolidated?.watch ?? []).slice(0, 2),
      facts: (c.memory_consolidated?.facts ?? []).slice(0, 2),
      // Clients workflow warnings — fed into the ClientWidget below.
      patternChangedKind: patternMap.get(c.id) ?? null,
      hasQuietChannel: quietByClient.has(c.id),
    };
  });

  // Rank by lifetime value (PHP) so the most valuable clients lead.
  enriched.sort((a, b) => b.paidBase - a.paidBase);

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 lg:px-10 lg:py-12">
      <PageHeader
        title="Clients"
        description="Who pays you, ranked by lifetime value. Open one to build its memory."
        actions={<ClientNewButton />}
      />

      <div className="mt-8">
        {enriched.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No clients yet."
            description="Add the people and companies who pay you. Their totals and memory live here."
            action={<ClientNewButton openInitial={params.new === "1"} />}
          />
        ) : (
          <ClientList clients={enriched} baseCurrency={baseCurrency} openNew={params.new === "1"} />
        )}
      </div>
    </div>
  );
}
