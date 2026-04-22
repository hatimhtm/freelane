import { FileText, Plus } from "lucide-react";
import { LinkButton } from "@/components/ui/link-button";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { getInvoicesWithClients } from "@/lib/data/queries";
import { InvoiceList } from "./_components/invoice-list";

export const metadata = { title: "Invoices" };

export default async function InvoicesPage() {
  const { invoices, clients } = await getInvoicesWithClients();
  const clientsById = new Map(clients.map((c) => [c.id, c]));

  return (
    <div className="mx-auto max-w-6xl p-6 lg:p-10">
      <PageHeader
        title="Invoices"
        description="Draft, issue, and export PDFs that mirror your branded template."
        actions={
          clients.length > 0 && (
            <LinkButton href="/invoices/new">
              <Plus className="mr-1.5 h-4 w-4" />
              New invoice
            </LinkButton>
          )
        }
      />

      <div className="mt-8">
        {clients.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="Add a client first"
            description="Invoices use your saved client details. Add one to get started."
            action={<LinkButton href="/clients?new=1">Add client</LinkButton>}
          />
        ) : invoices.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No invoices yet"
            description="Create your first invoice — it'll use your template automatically."
            action={
              <LinkButton href="/invoices/new">
                <Plus className="mr-1.5 h-4 w-4" />
                New invoice
              </LinkButton>
            }
          />
        ) : (
          <InvoiceList invoices={invoices} clientsById={clientsById} />
        )}
      </div>
    </div>
  );
}
