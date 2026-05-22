import { Users } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { getClients } from "@/lib/data/queries";
import { createClient as createSupabase } from "@/lib/supabase/server";
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
  const [projectsRes, paymentsRes] = await Promise.all([
    supabase.from("projects").select("id,client_id,amount,currency,status"),
    supabase.from("payments").select("project_id,amount,currency"),
  ]);
  const projects = projectsRes.data ?? [];
  const payments = paymentsRes.data ?? [];

  const enriched = clients.map((c) => {
    const clientProjects = projects.filter((p) => p.client_id === c.id);
    const projectIds = new Set(clientProjects.map((p) => p.id));
    const paid = payments
      .filter((p) => projectIds.has(p.project_id))
      .reduce((s, p) => s + Number(p.amount), 0);
    return {
      ...c,
      projectCount: clientProjects.length,
      paidTotal: paid,
    };
  });

  return (
    <div className="mx-auto max-w-6xl p-6 lg:p-10">
      <PageHeader
        title="Clients"
        description="Who pays you. Open one to build its memory and see what's owed."
        actions={<ClientNewButton />}
      />

      <div className="mt-8">
        {enriched.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No clients yet"
            description="Add the companies or people you invoice. Their details live here and auto-fill when you create invoices."
            action={<ClientNewButton openInitial={params.new === "1"} />}
          />
        ) : (
          <ClientList clients={enriched} openNew={params.new === "1"} />
        )}
      </div>
    </div>
  );
}
