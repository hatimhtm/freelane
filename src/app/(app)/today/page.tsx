import { getDashboardData } from "@/lib/data/queries";
import {
  cashflowMetrics,
  outstanding,
  outstandingTotalBase,
  dailySeries,
} from "@/lib/dashboard-calc";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import type { CurrencyCode } from "@/lib/supabase/types";
import { TodayView } from "./_components/today-view";

export const metadata = { title: "Today" };

export default async function TodayPage() {
  const { settings, projects, payments, rates, clients, methods } = await getDashboardData();

  const currency = (settings?.base_currency ?? BASE_CURRENCY_FALLBACK) as CurrencyCode;
  const recurringFee = methods.reduce((s, m) => s + Number(m.monthly_fee_php ?? 0), 0);

  const metrics = cashflowMetrics(payments, new Date(), recurringFee);
  const rows = outstanding(projects, payments, clients, rates);
  const pendingTotal = outstandingTotalBase(rows);
  const series = dailySeries(payments, 30);

  const oldest = rows[0] ?? null;

  // One sentence + one action — the whole point of this screen.
  let situation: string;
  let action: { label: string; href: string };

  if (clients.length === 0) {
    situation = "No clients yet. Add the first one and Freelane starts keeping score.";
    action = { label: "Add a client", href: "/clients?new=1" };
  } else if (oldest) {
    const who = oldest.client?.name ?? "A client";
    const others = rows.length - 1;
    situation =
      `${who} owes the most right now` +
      (oldest.daysAged > 0 ? ` — waiting ${oldest.daysAged} ${oldest.daysAged === 1 ? "day" : "days"}` : "") +
      (others > 0 ? `, with ${others} other ${others === 1 ? "project" : "projects"} still open.` : ".");
    action = { label: `Open ${who}`, href: "/projects" };
  } else {
    situation = "Nothing's waiting on you. Every project is settled.";
    action = { label: "Log a payment", href: "/payments?new=1" };
  }

  return (
    <TodayView
      firstName={settings?.issuer_name?.split(" ")[0] ?? null}
      currency={currency}
      mtd={metrics.mtd}
      momDelta={metrics.momDelta}
      series={series}
      pendingTotal={pendingTotal}
      pendingCount={rows.length}
      wtd={metrics.wtd}
      feesMtd={metrics.feesMtd}
      situation={situation}
      action={action}
    />
  );
}
