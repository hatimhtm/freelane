import { redirect } from "next/navigation";
import { getSettings, getClients, getInvoicesWithClients } from "@/lib/data/queries";
import { buildInvoiceNumber } from "@/lib/invoice-number";
import { InvoiceEditor } from "../_components/invoice-editor";

export const metadata = { title: "New invoice" };

export default async function NewInvoicePage() {
  const [{ settings }, clients, { invoices }] = await Promise.all([
    getSettings(),
    getClients(),
    getInvoicesWithClients(),
  ]);

  if (clients.length === 0) redirect("/clients?new=1");

  const nextNumber = buildInvoiceNumber(
    settings?.invoice_number_format ?? "YYYY-NNN",
    invoices.map((i) => ({ invoice_number: i.invoice_number, issue_date: i.issue_date })),
  );

  return (
    <InvoiceEditor
      mode="new"
      clients={clients.filter((c) => !c.archived)}
      settings={settings}
      defaultInvoiceNumber={nextNumber}
    />
  );
}
