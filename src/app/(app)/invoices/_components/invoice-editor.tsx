"use client";

import { useMemo, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Download, Plus, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createInvoice, updateInvoice, deleteInvoice } from "@/lib/data/actions";
import { formatMoney } from "@/lib/money";
import type { Client, Invoice, LineItem, Settings } from "@/lib/supabase/types";

const CURRENCIES = ["PHP", "MAD", "USD", "EUR", "CNY"];

const InvoicePdfDownload = dynamic(
  () => import("./invoice-pdf").then((m) => m.InvoicePdfDownload),
  { ssr: false, loading: () => <span className="text-xs text-muted-foreground">Preparing PDF…</span> },
);

type EditorProps = {
  mode: "new" | "edit";
  clients: Client[];
  settings: Settings | null;
  defaultInvoiceNumber?: string;
  invoice?: Invoice;
};

type EditorState = {
  client_id: string;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  currency: string;
  language: string;
  line_items: LineItem[];
  tva_rate: number;
  show_tva_note: boolean;
  tva_note: string;
  footer: string;
  notes: string;
};

export function InvoiceEditor({
  mode,
  clients,
  settings,
  defaultInvoiceNumber,
  invoice,
}: EditorProps) {
  const router = useRouter();

  const initialState = useMemo<EditorState>(() => {
    if (invoice) {
      return {
        client_id: invoice.client_id,
        invoice_number: invoice.invoice_number,
        issue_date: invoice.issue_date,
        due_date: invoice.due_date ?? "",
        currency: invoice.currency,
        language: invoice.language,
        line_items: (invoice.line_items ?? []) as LineItem[],
        tva_rate: Number(invoice.tva_rate ?? 0),
        show_tva_note: invoice.show_tva_note,
        tva_note: invoice.tva_note ?? "",
        footer: invoice.footer ?? "",
        notes: invoice.notes ?? "",
      };
    }
    const firstClient = clients[0];
    return {
      client_id: firstClient?.id ?? "",
      invoice_number: defaultInvoiceNumber ?? "",
      issue_date: new Date().toISOString().slice(0, 10),
      due_date: "",
      currency: firstClient?.default_currency ?? settings?.base_currency ?? "PHP",
      language: settings?.invoice_language ?? "fr",
      line_items: [{ description: "", quantity: 1, unit_price: 0, amount: 0 }],
      tva_rate: 0,
      show_tva_note: settings?.invoice_show_tva_note ?? true,
      tva_note: settings?.invoice_tva_note ?? "",
      footer: settings?.invoice_footer ?? "",
      notes: "",
    };
  }, [invoice, clients, defaultInvoiceNumber, settings]);

  const [state, setState] = useState<EditorState>(initialState);
  const [pending, start] = useTransition();

  const client = useMemo(
    () => clients.find((c) => c.id === state.client_id),
    [clients, state.client_id],
  );

  const totals = useMemo(() => {
    const subtotal = state.line_items.reduce((s, li) => s + Number(li.amount || 0), 0);
    const tva_amount = state.tva_rate > 0 ? +(subtotal * (state.tva_rate / 100)).toFixed(2) : 0;
    const total = +(subtotal + tva_amount).toFixed(2);
    return { subtotal, tva_amount, total };
  }, [state.line_items, state.tva_rate]);

  function updateLineItem(index: number, patch: Partial<LineItem>) {
    setState((prev) => {
      const next = [...prev.line_items];
      const merged = { ...next[index], ...patch };
      merged.amount = +(Number(merged.quantity || 0) * Number(merged.unit_price || 0)).toFixed(2);
      next[index] = merged;
      return { ...prev, line_items: next };
    });
  }

  function addLineItem() {
    setState((prev) => ({
      ...prev,
      line_items: [...prev.line_items, { description: "", quantity: 1, unit_price: 0, amount: 0 }],
    }));
  }

  function removeLineItem(index: number) {
    setState((prev) => ({
      ...prev,
      line_items: prev.line_items.filter((_, i) => i !== index),
    }));
  }

  async function onSave(options: { stayOnPage?: boolean } = {}) {
    if (!client) {
      toast.error("Pick a client first");
      return;
    }
    if (!state.invoice_number.trim()) {
      toast.error("Invoice number is required");
      return;
    }

    const payload = {
      client_id: state.client_id,
      invoice_number: state.invoice_number.trim(),
      issue_date: state.issue_date,
      due_date: state.due_date || null,
      currency: state.currency,
      language: state.language,
      line_items: state.line_items,
      subtotal: totals.subtotal,
      tva_rate: state.tva_rate,
      tva_amount: totals.tva_amount,
      total: totals.total,
      show_tva_note: state.show_tva_note,
      tva_note: state.tva_note,
      footer: state.footer,
      notes: state.notes,
      issuer_snapshot: {
        name: settings?.issuer_name,
        role: settings?.issuer_role,
        address: settings?.issuer_address,
        phone: settings?.issuer_phone,
        email: settings?.issuer_email,
        cin: settings?.issuer_cin,
      },
      client_snapshot: {
        name: client.name,
        company: client.company,
        address: client.address,
        city: client.city,
        country: client.country,
        ice: client.ice,
        rc: client.rc,
        tax_id: client.tax_id,
      },
    };

    start(async () => {
      try {
        if (mode === "new") {
          const res = await createInvoice(payload);
          toast.success("Invoice saved");
          if (!options.stayOnPage) router.push(`/invoices/${res.id}`);
        } else if (invoice) {
          await updateInvoice(invoice.id, payload);
          toast.success("Invoice updated");
        }
      } catch (err: unknown) {
        toast.error((err as Error).message);
      }
    });
  }

  async function onDelete() {
    if (!invoice) return;
    if (!confirm("Delete this invoice permanently?")) return;
    try {
      await deleteInvoice(invoice.id);
      toast.success("Invoice deleted");
      router.push("/invoices");
    } catch (err: unknown) {
      toast.error((err as Error).message);
    }
  }

  const pdfData = {
    issuer: {
      name: settings?.issuer_name ?? "",
      role: settings?.issuer_role ?? "",
      address: settings?.issuer_address ?? "",
      phone: settings?.issuer_phone ?? "",
      email: settings?.issuer_email ?? "",
      cin: settings?.issuer_cin ?? "",
    },
    client: {
      name: client?.name ?? "",
      company: client?.company ?? null,
      address: client?.address ?? null,
      city: client?.city ?? null,
      country: client?.country ?? null,
      ice: client?.ice ?? null,
      rc: client?.rc ?? null,
    },
    invoice_number: state.invoice_number,
    issue_date: state.issue_date,
    due_date: state.due_date || null,
    currency: state.currency,
    language: state.language,
    line_items: state.line_items,
    subtotal: totals.subtotal,
    tva_rate: state.tva_rate,
    tva_amount: totals.tva_amount,
    total: totals.total,
    show_tva_note: state.show_tva_note,
    tva_note: state.tva_note,
    footer: state.footer,
    accent_color: settings?.invoice_accent_color ?? "#2c3e50",
  };

  return (
    <div className="mx-auto max-w-6xl p-6 lg:p-10">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button nativeButton={false} render={<Link href="/invoices" />} variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {mode === "new" ? "New invoice" : "Invoice"}
            </div>
            <h1 className="text-xl font-semibold">{state.invoice_number || "—"}</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {mode === "edit" && (
            <Button variant="ghost" onClick={onDelete} className="text-destructive">
              <Trash2 className="mr-1.5 h-4 w-4" />
              Delete
            </Button>
          )}
          <InvoicePdfDownload data={pdfData} fileName={`${state.invoice_number || "invoice"}.pdf`}>
            <Download className="mr-1.5 h-4 w-4" />
            PDF
          </InvoicePdfDownload>
          <Button onClick={() => onSave()} disabled={pending}>
            {pending ? "Saving…" : mode === "new" ? "Save invoice" : "Save changes"}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_minmax(320px,380px)]">
        <Card className="p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client">
              <Select
                value={state.client_id}
                onValueChange={(v) => {
                  if (!v) return;
                  const c = clients.find((x) => x.id === v);
                  setState((prev) => ({
                    ...prev,
                    client_id: v,
                    currency: c?.default_currency ?? prev.currency,
                  }));
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Invoice number">
              <Input
                value={state.invoice_number}
                onChange={(e) => setState((p) => ({ ...p, invoice_number: e.target.value }))}
              />
            </Field>
            <Field label="Issue date">
              <Input
                type="date"
                value={state.issue_date}
                onChange={(e) => setState((p) => ({ ...p, issue_date: e.target.value }))}
              />
            </Field>
            <Field label="Due date (optional)">
              <Input
                type="date"
                value={state.due_date}
                onChange={(e) => setState((p) => ({ ...p, due_date: e.target.value }))}
              />
            </Field>
            <Field label="Currency">
              <Select
                value={state.currency}
                onValueChange={(v) => {
                  if (!v) return;
                  setState((p) => ({ ...p, currency: v }));
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Language">
              <Input
                value={state.language}
                onChange={(e) => setState((p) => ({ ...p, language: e.target.value }))}
                placeholder="fr"
              />
            </Field>
          </div>

          <Separator className="my-6" />

          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-medium">Line items</div>
            <Button type="button" variant="ghost" size="sm" onClick={addLineItem}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add row
            </Button>
          </div>
          <div className="overflow-hidden rounded-lg border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Description</th>
                  <th className="px-3 py-2 text-right w-24">Qty</th>
                  <th className="px-3 py-2 text-right w-32">Unit</th>
                  <th className="px-3 py-2 text-right w-32">Amount</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {state.line_items.map((li, i) => (
                  <tr key={i} className="group">
                    <td className="px-3 py-1.5">
                      <Input
                        value={li.description}
                        onChange={(e) => updateLineItem(i, { description: e.target.value })}
                        placeholder="Description"
                        className="h-8 border-transparent bg-transparent focus-visible:bg-background"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <Input
                        type="number"
                        step="1"
                        value={li.quantity}
                        onChange={(e) => updateLineItem(i, { quantity: Number(e.target.value) })}
                        className="h-8 text-right tabular"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <Input
                        type="number"
                        step="0.01"
                        value={li.unit_price}
                        onChange={(e) => updateLineItem(i, { unit_price: Number(e.target.value) })}
                        className="h-8 text-right tabular"
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right tabular">
                      {formatMoney(Number(li.amount || 0), state.currency)}
                    </td>
                    <td className="px-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                        onClick={() => removeLineItem(i)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Separator className="my-6" />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="TVA rate (%)">
              <Input
                type="number"
                step="0.01"
                value={state.tva_rate}
                onChange={(e) => setState((p) => ({ ...p, tva_rate: Number(e.target.value) }))}
              />
            </Field>
            <div className="flex items-end justify-between rounded-lg border border-border/60 bg-muted/30 px-4 py-2">
              <div>
                <div className="text-xs font-medium">Show TVA note</div>
                <div className="text-[11px] text-muted-foreground">Under the total</div>
              </div>
              <Switch
                checked={state.show_tva_note}
                onCheckedChange={(v) => setState((p) => ({ ...p, show_tva_note: v }))}
              />
            </div>
          </div>

          {state.show_tva_note && (
            <Field label="TVA note" className="mt-4">
              <Input
                value={state.tva_note}
                onChange={(e) => setState((p) => ({ ...p, tva_note: e.target.value }))}
              />
            </Field>
          )}

          <Field label="Footer" className="mt-4">
            <Textarea
              rows={2}
              value={state.footer}
              onChange={(e) => setState((p) => ({ ...p, footer: e.target.value }))}
            />
          </Field>
        </Card>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Card className="sticky top-20 p-6">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Totals
            </div>
            <div className="mt-4 space-y-2.5 tabular">
              <Row label="Subtotal" value={formatMoney(totals.subtotal, state.currency)} />
              {state.tva_rate > 0 && (
                <Row
                  label={`TVA (${state.tva_rate}%)`}
                  value={formatMoney(totals.tva_amount, state.currency)}
                />
              )}
              <Separator />
              <Row
                label="Total"
                value={formatMoney(totals.total, state.currency)}
                strong
              />
            </div>

            {client && (
              <div className="mt-6 rounded-lg border border-border/60 bg-muted/30 p-4 text-xs">
                <div className="font-semibold">{client.name}</div>
                {client.company && <div>{client.company}</div>}
                {client.address && <div className="mt-1 text-muted-foreground">{client.address}</div>}
                {(client.city || client.country) && (
                  <div className="text-muted-foreground">
                    {[client.city, client.country].filter(Boolean).join(", ")}
                  </div>
                )}
                {client.ice && <div className="mt-2 text-muted-foreground">ICE: {client.ice}</div>}
                {client.rc && <div className="text-muted-foreground">RC: {client.rc}</div>}
              </div>
            )}
          </Card>
        </motion.div>
      </div>
    </div>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={strong ? "text-sm font-semibold" : "text-xs text-muted-foreground"}>
        {label}
      </span>
      <span className={strong ? "text-lg font-semibold" : "text-sm"}>{value}</span>
    </div>
  );
}
