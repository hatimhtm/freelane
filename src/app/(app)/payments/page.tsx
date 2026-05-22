import { getPaymentsData } from "@/lib/data/queries";
import { methodLeaderboard, paymentFee, chainSignature, sortedSteps } from "@/lib/payment-chain";
import { landedInRange } from "@/lib/dashboard-calc";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import type { CurrencyCode, PaymentMethod } from "@/lib/supabase/types";
import { PaymentsView, type PaymentRow, type ChainStepView } from "./_components/payments-view";

export const metadata = { title: "Payments" };

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const params = await searchParams;
  const { payments, stepsByPayment, projects, clients, rates, methods, settings } = await getPaymentsData();
  const currency = (settings?.base_currency ?? BASE_CURRENCY_FALLBACK) as CurrencyCode;

  const methodsById = new Map<string, PaymentMethod>(methods.map((m) => [m.id, m]));
  const projectsById = new Map(projects.map((p) => [p.id, p]));
  const clientsById = new Map(clients.map((c) => [c.id, c]));

  const leaderboard = methodLeaderboard(payments, stepsByPayment, methodsById);

  const rows: PaymentRow[] = payments.map((p) => {
    const steps = sortedSteps(stepsByPayment.get(p.id) ?? []);
    const project = projectsById.get(p.project_id);
    const client = project ? clientsById.get(project.client_id) : undefined;
    const { fee, pct, net } = paymentFee(p);
    return {
      id: p.id,
      projectTitle: project?.title ?? "—",
      clientName: client?.name ?? "—",
      paidAt: p.paid_at,
      amountIn: Number(p.amount),
      currencyIn: p.currency as CurrencyCode,
      netBase: net,
      feeBase: fee,
      feePct: pct,
      signature: chainSignature(steps, methodsById),
      steps: steps.map<ChainStepView>((s) => ({
        order: s.step_order,
        methodName: s.method_id ? methodsById.get(s.method_id)?.name ?? "Untagged" : "Untagged",
        amountIn: Number(s.amount_in),
        currencyIn: s.currency_in as CurrencyCode,
        amountOut: Number(s.amount_out),
        currencyOut: s.currency_out as CurrencyCode,
      })),
    };
  });

  const now = new Date();
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const receivedThisMonth = landedInRange(payments, startMonth);
  const lifetime = payments.reduce((s, p) => s + Number(p.net_amount_base ?? 0), 0);
  const feesThisMonth = payments
    .filter((p) => new Date(p.paid_at) >= startMonth)
    .reduce((s, p) => s + Number(p.implied_fee_base ?? 0), 0);

  // Projects that still have a balance, for the chain form's project picker.
  const openProjects = projects
    .filter((p) => p.status === "unpaid" || p.status === "partially_paid")
    .map((p) => ({ id: p.id, title: p.title, currency: p.currency as CurrencyCode, clientName: clientsById.get(p.client_id)?.name ?? "" }));
  const allProjects = projects.map((p) => ({ id: p.id, title: p.title, currency: p.currency as CurrencyCode, clientName: clientsById.get(p.client_id)?.name ?? "" }));

  return (
    <PaymentsView
      rows={rows}
      leaderboard={leaderboard}
      currency={currency}
      receivedThisMonth={receivedThisMonth}
      lifetime={lifetime}
      feesThisMonth={feesThisMonth}
      methods={methods.filter((m) => !m.archived).map((m) => ({ id: m.id, name: m.name }))}
      openProjects={openProjects}
      allProjects={allProjects}
      rates={rates.map((r) => ({ code: r.code, rate_to_base: Number(r.rate_to_base) }))}
      openNew={params.new === "1"}
    />
  );
}
