import { getPaymentsData } from "@/lib/data/queries";
import {
  methodLeaderboard,
  paymentFee,
  chainSignature,
  sortedSteps,
  finalStep,
  holdingBalances,
} from "@/lib/payment-chain";
import { landedInRange, withdrawalFeesInRange } from "@/lib/dashboard-calc";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import type { CurrencyCode, PaymentMethod } from "@/lib/supabase/types";
import { PaymentsView, type PaymentRow, type ChainStepView, type WithdrawalRow, type HoldingRow } from "./_components/payments-view";

export const metadata = { title: "Payments" };

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; project?: string; withdraw?: string }>;
}) {
  const params = await searchParams;
  const { payments, stepsByPayment, projects, clients, rates, methods, settings, currencies, withdrawals } = await getPaymentsData();
  const currency = (settings?.base_currency ?? BASE_CURRENCY_FALLBACK) as CurrencyCode;

  const methodsById = new Map<string, PaymentMethod>(methods.map((m) => [m.id, m]));
  const projectsById = new Map(projects.map((p) => [p.id, p]));
  const clientsById = new Map(clients.map((c) => [c.id, c]));

  const leaderboard = methodLeaderboard(payments, stepsByPayment, methodsById, rates);

  const rows: PaymentRow[] = payments.map((p) => {
    const steps = sortedSteps(stepsByPayment.get(p.id) ?? []);
    const project = projectsById.get(p.project_id);
    const client = project ? clientsById.get(project.client_id) : undefined;
    const { fee, pct, net, gross } = paymentFee(p);
    const landingId = finalStep(steps)?.method_id ?? null;
    const sourceId = steps[0]?.from_method_id ?? null;
    const nameOf = (id: string | null) => (id ? methodsById.get(id)?.name ?? "Untagged" : null);
    return {
      id: p.id,
      projectTitle: project?.title ?? "—",
      clientName: client?.name ?? "—",
      paidAt: p.paid_at,
      amountIn: Number(p.amount),
      currencyIn: p.currency as CurrencyCode,
      netBase: net,
      grossBase: gross,
      feeBase: fee,
      feePct: pct,
      methodId: landingId,
      fromMethodId: sourceId,
      landingName: landingId ? methodsById.get(landingId)?.name ?? "Untagged" : "Untagged",
      feeUnknown: p.fee_unknown ?? false,
      signature: chainSignature(steps, methodsById),
      steps: steps.map<ChainStepView>((s) => ({
        order: s.step_order,
        fromName: nameOf(s.from_method_id),
        toName: nameOf(s.method_id) ?? "Untagged",
        amountIn: Number(s.amount_in),
        currencyIn: s.currency_in as CurrencyCode,
        amountOut: Number(s.amount_out),
        currencyOut: s.currency_out as CurrencyCode,
      })),
    };
  });

  // Holding wallets (coin.ph, Cash) + their parked balances.
  const holdings: HoldingRow[] = holdingBalances(methods, payments, stepsByPayment, withdrawals);
  const balanceByMethod = new Map(holdings.map((h) => [h.methodId, h.balance]));

  const withdrawalRows: WithdrawalRow[] = withdrawals.map((w) => {
    const g = Number(w.gross_base ?? 0);
    const f = Number(w.fee_base ?? 0);
    return {
      id: w.id,
      fromName: w.from_method_id ? methodsById.get(w.from_method_id)?.name ?? "Untagged" : "Untagged",
      toName: w.to_method_id ? methodsById.get(w.to_method_id)?.name ?? null : null,
      withdrawnAt: w.withdrawn_at,
      grossBase: g,
      netBase: Number(w.net_base ?? 0),
      feeBase: f,
      feePct: g > 0 ? f / g : 0,
    };
  });

  const now = new Date();
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const withdrawalFeesMonth = withdrawalFeesInRange(withdrawals, startMonth);
  const withdrawalFeesLifetime = withdrawals.reduce((s, w) => s + Number(w.fee_base ?? 0), 0);
  // Landed = money received minus the fees that ate it (chain + withdrawal).
  const receivedThisMonth = Math.max(0, landedInRange(payments, startMonth) - withdrawalFeesMonth);
  const lifetime = Math.max(0, payments.reduce((s, p) => s + Number(p.net_amount_base ?? 0), 0) - withdrawalFeesLifetime);
  const feesThisMonth = payments
    .filter((p) => new Date(p.paid_at) >= startMonth)
    .reduce((s, p) => s + Number(p.implied_fee_base ?? 0), 0) + withdrawalFeesMonth;

  // Outstanding (native) per project, so the chain form can prefill the amount.
  const outstandingByProject = new Map<string, number>();
  for (const p of projects) {
    const paid = payments
      .filter((pay) => pay.project_id === p.id && pay.currency === p.currency)
      .reduce((s, pay) => s + Number(pay.amount), 0);
    outstandingByProject.set(p.id, Math.max(0, Number(p.amount) - paid));
  }
  const toOpt = (p: typeof projects[number]) => ({
    id: p.id,
    title: p.title,
    currency: p.currency as CurrencyCode,
    clientName: clientsById.get(p.client_id)?.name ?? "",
    outstanding: outstandingByProject.get(p.id) ?? 0,
  });

  // Projects that still have a balance, for the chain form's project picker.
  const openProjects = projects
    .filter((p) => p.status === "unpaid" || p.status === "partially_paid")
    .map(toOpt);
  const allProjects = projects.map(toOpt);

  const activeMethods = methods.filter((m) => !m.archived);
  const holdingMethodOpts = activeMethods
    .filter((m) => m.is_holding)
    .map((m) => ({ id: m.id, name: m.name, balance: balanceByMethod.get(m.id) ?? 0 }));
  const cashMethod = activeMethods.find((m) => m.name.toLowerCase() === "cash");

  return (
    <PaymentsView
      rows={rows}
      leaderboard={leaderboard}
      currency={currency}
      receivedThisMonth={receivedThisMonth}
      lifetime={lifetime}
      feesThisMonth={feesThisMonth}
      methods={activeMethods.map((m) => ({ id: m.id, name: m.name }))}
      holdings={holdings}
      withdrawals={withdrawalRows}
      holdingMethods={holdingMethodOpts}
      cashMethodId={cashMethod?.id}
      openProjects={openProjects}
      allProjects={allProjects}
      allCurrencies={currencies.map((c) => c.code)}
      rates={rates.map((r) => ({ code: r.code, rate_to_base: Number(r.rate_to_base) }))}
      openNew={params.new === "1" || !!params.project}
      openWithdraw={params.withdraw === "1"}
      defaultProjectId={params.project}
    />
  );
}
