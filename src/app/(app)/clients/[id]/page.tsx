import { notFound } from "next/navigation";
import {
  getClientDetail,
  getClientFacts,
  getClientPatternHistory,
  getOpenQuietChannelForClient,
  getRateInsightsForClient,
  getSettings,
} from "@/lib/data/queries";
import { outstanding } from "@/lib/dashboard-calc";
import { hasGemini } from "@/lib/ai/gemini";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import type { CurrencyCode } from "@/lib/supabase/types";
import { ClientDetail } from "./_components/client-detail";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { client } = await getClientDetail(id);
  return { title: client?.name ?? "Client" };
}

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [
    { client, memory, projects, payments, events },
    { rates, settings },
    quietChannel,
    rateInsights,
    facts,
    patternHistory,
  ] = await Promise.all([
    getClientDetail(id),
    getSettings(),
    getOpenQuietChannelForClient(id).catch(() => null),
    getRateInsightsForClient(id, 8).catch(() => []),
    getClientFacts(id).catch(() => []),
    getClientPatternHistory(id, 20).catch(() => []),
  ]);
  if (!client) notFound();

  const currency = (settings?.base_currency ?? BASE_CURRENCY_FALLBACK) as CurrencyCode;

  const clientProjectIds = new Set(projects.map((p) => p.id));
  const clientPayments = payments.filter((p) => clientProjectIds.has(p.project_id));
  const landed = clientPayments.reduce((s, p) => s + Number(p.net_amount_base ?? 0), 0);

  const rows = outstanding(projects, payments, [client], rates);
  const outstandingTotal = rows.reduce((s, r) => s + r.outstandingBase, 0);

  const projectViews = projects.map((p) => {
    const paid = clientPayments
      .filter((pay) => pay.project_id === p.id && pay.currency === p.currency)
      .reduce((s, pay) => s + Number(pay.amount), 0);
    return {
      id: p.id,
      title: p.title,
      amount: Number(p.amount),
      currency: p.currency as CurrencyCode,
      status: p.status,
      outstandingNative: Math.max(0, Number(p.amount) - paid),
    };
  });

  return (
    <ClientDetail
      client={client}
      currency={currency}
      landed={landed}
      outstandingTotal={outstandingTotal}
      memory={memory.map((m) => ({ id: m.id, content: m.content, createdAt: m.created_at, consolidated: !!m.consolidated_at }))}
      consolidated={client.memory_consolidated ?? {}}
      projects={projectViews}
      events={events.map((e) => ({ id: e.id, title: e.title, createdAt: e.created_at }))}
      aiEnabled={hasGemini()}
      hasOutstanding={outstandingTotal > 0}
      quietChannel={quietChannel}
      rateInsights={rateInsights}
      facts={facts}
      patternHistory={patternHistory}
    />
  );
}
