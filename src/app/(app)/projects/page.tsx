import { getProjectsWithClients } from "@/lib/data/queries";
import { outstanding } from "@/lib/dashboard-calc";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import type { CurrencyCode } from "@/lib/supabase/types";
import type { BlockedRow } from "@/components/app/blocked-money-list";
import { ProjectsView } from "./_components/projects-view";

export const metadata = { title: "Projects" };

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const params = await searchParams;
  const { projects, clients, payments, templates, rates, settings } = await getProjectsWithClients();
  const currency = (settings?.base_currency ?? BASE_CURRENCY_FALLBACK) as CurrencyCode;

  const rows = outstanding(projects, payments, clients, rates);
  const blocked: BlockedRow[] = rows.map((r) => ({
    projectId: r.project.id,
    projectTitle: r.project.title,
    clientName: r.client?.name ?? "—",
    outstandingNative: r.outstandingNative,
    currency: r.project.currency as CurrencyCode,
    outstandingBase: r.outstandingBase,
    daysAged: r.daysAged,
    status: r.project.status === "partially_paid" ? "partially_paid" : "unpaid",
    flagged: r.project.flagged_overdue,
  }));

  const clientsById = new Map(clients.map((c) => [c.id, c]));
  const paid = projects
    .filter((p) => p.status === "paid")
    .sort((a, b) => (b.completed_at ?? b.updated_at).localeCompare(a.completed_at ?? a.updated_at))
    .slice(0, 12)
    .map((p) => ({
      id: p.id,
      title: p.title,
      clientName: clientsById.get(p.client_id)?.name ?? "—",
      amount: Number(p.amount),
      currency: p.currency as CurrencyCode,
      completedAt: p.completed_at ?? p.updated_at,
    }));

  return (
    <ProjectsView
      projects={projects}
      clients={clients}
      payments={payments}
      templates={templates}
      blocked={blocked}
      paid={paid}
      currency={currency}
      openNew={params.new === "1"}
    />
  );
}
