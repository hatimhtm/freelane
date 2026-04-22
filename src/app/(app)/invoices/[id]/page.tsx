import { notFound } from "next/navigation";
import { createClient as createSupabase } from "@/lib/supabase/server";
import { getClients, getSettings } from "@/lib/data/queries";
import { InvoiceEditor } from "../_components/invoice-editor";
import type { Invoice } from "@/lib/supabase/types";

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabase();
  const { data: invoice } = await supabase.from("invoices").select("*").eq("id", id).maybeSingle();
  if (!invoice) notFound();

  const [{ settings }, clients] = await Promise.all([getSettings(), getClients()]);

  return (
    <InvoiceEditor
      mode="edit"
      invoice={invoice as Invoice}
      clients={clients}
      settings={settings}
    />
  );
}
