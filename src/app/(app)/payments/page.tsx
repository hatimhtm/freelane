import { Wallet } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { createClient as createSupabase } from "@/lib/supabase/server";
import { getSettings } from "@/lib/data/queries";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import { PaymentsHub } from "./_components/payments-hub";
import type { Client, Invoice, Payment, Project } from "@/lib/supabase/types";

export const metadata = { title: "Payments" };

export default async function PaymentsPage() {
  const supabase = await createSupabase();
  const [{ settings, rates }, paymentsRes, projectsRes, clientsRes, invoicesRes] = await Promise.all([
    getSettings(),
    supabase.from("payments").select("*").order("paid_at", { ascending: false }),
    supabase.from("projects").select("*"),
    supabase.from("clients").select("*"),
    supabase.from("invoices").select("*"),
  ]);

  const payments = (paymentsRes.data ?? []) as Payment[];
  const projects = (projectsRes.data ?? []) as Project[];
  const clients = (clientsRes.data ?? []) as Client[];
  const invoices = (invoicesRes.data ?? []) as Invoice[];

  const base = settings?.base_currency ?? BASE_CURRENCY_FALLBACK;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-10">
      <PageHeader
        title="Payments"
        description="Every coin you've received — grouped, filterable, exportable to invoices."
      />

      <div className="mt-8">
        {payments.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="No payments logged yet"
            description="Log payments from a project card. They'll appear here with totals and filters by week or month."
          />
        ) : (
          <PaymentsHub
            payments={payments}
            projects={projects}
            clients={clients}
            invoices={invoices}
            rates={rates}
            baseCurrency={base}
          />
        )}
      </div>
    </div>
  );
}
