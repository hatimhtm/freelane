"use client";

import { useRouter } from "next/navigation";
import { useTransition, useState, useEffect } from "react";
import { toast } from "sonner";
import { ExternalLink, FileText, Sparkles, Trash2 } from "lucide-react";
import { LinkButton } from "@/components/ui/link-button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { formatMoney, convert } from "@/lib/money";
import { createInvoiceFromPayment, deletePayment, updatePayment } from "@/lib/data/actions";
import type {
  Client,
  CurrencyCode,
  ExchangeRate,
  Invoice,
  Payment,
  Project,
} from "@/lib/supabase/types";

type Props = {
  payment: Payment | null;
  project?: Project;
  client?: Client;
  invoice?: Invoice | null;
  rates: ExchangeRate[];
  baseCurrency: CurrencyCode;
  open: boolean;
  onOpenChange: (v: boolean) => void;
};

export function PaymentSheet({
  payment,
  project,
  client,
  invoice,
  rates,
  baseCurrency,
  open,
  onOpenChange,
}: Props) {
  const router = useRouter();
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    if (payment) {
      setMethod(payment.method ?? "");
      setReference(payment.reference ?? "");
      setNotes(payment.notes ?? "");
    }
  }, [payment]);

  if (!payment) return null;

  const amountInBase = convert(
    Number(payment.amount),
    payment.currency as CurrencyCode,
    baseCurrency,
    rates,
  );

  async function onSaveDetails() {
    if (!payment) return;
    start(async () => {
      try {
        await updatePayment(payment.id, { method, reference, notes });
        toast.success("Payment updated");
      } catch (err: unknown) {
        toast.error((err as Error).message);
      }
    });
  }

  async function onGenerateInvoice() {
    if (!payment) return;
    start(async () => {
      try {
        const res = await createInvoiceFromPayment(payment.id);
        toast.success(res.created ? "Invoice drafted" : "Opening invoice");
        router.push(`/invoices/${res.id}`);
        onOpenChange(false);
      } catch (err: unknown) {
        toast.error((err as Error).message);
      }
    });
  }

  async function onDelete() {
    if (!payment) return;
    if (!confirm("Delete this payment? The linked invoice (if any) will stay.")) return;
    try {
      await deletePayment(payment.id);
      toast.success("Payment deleted");
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error((err as Error).message);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto scroll-muted">
        <SheetHeader>
          <SheetTitle>Payment</SheetTitle>
          <SheetDescription>
            Received {new Date(payment.paid_at).toLocaleDateString(undefined, {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-4 py-6">
          <div className="rounded-2xl border border-[var(--brand)]/25 bg-gradient-to-br from-[var(--brand)]/5 to-transparent p-5">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Amount
            </div>
            <div className="mt-2 text-3xl font-semibold tabular">
              {formatMoney(Number(payment.amount), payment.currency as CurrencyCode)}
            </div>
            {payment.currency !== baseCurrency && (
              <div className="mt-1 text-xs text-muted-foreground tabular">
                ≈ {formatMoney(amountInBase, baseCurrency)} at your current rate
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <Meta label="Project" value={project?.title ?? "—"} />
            <Meta label="Client" value={client?.name ?? "—"} />
            <Meta label="Currency" value={payment.currency} />
            <Meta label="Date" value={new Date(payment.paid_at).toLocaleDateString()} />
          </div>

          <Separator />

          <div className="space-y-3">
            <Field label="Method">
              <Input
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                placeholder="Wise, bank transfer, PayPal…"
                onBlur={onSaveDetails}
              />
            </Field>
            <Field label="Reference / transaction ID">
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="TX-…"
                onBlur={onSaveDetails}
              />
            </Field>
            <Field label="Notes">
              <Textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything worth remembering…"
                onBlur={onSaveDetails}
              />
            </Field>
          </div>

          <Separator />

          <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <FileText className="h-4 w-4" />
              Invoice
            </div>
            {invoice ? (
              <>
                <div className="mb-3 text-xs text-muted-foreground">
                  This payment is linked to an invoice.
                </div>
                <LinkButton
                  href={`/invoices/${invoice.id}`}
                  variant="outline"
                  className="w-full"
                  onClick={() => onOpenChange(false)}
                >
                  <ExternalLink className="mr-2 h-3.5 w-3.5" />
                  Open {invoice.invoice_number}
                </LinkButton>
              </>
            ) : (
              <>
                <div className="mb-3 text-xs text-muted-foreground">
                  No invoice for this payment. Click below to generate one from it — the amount,
                  client, and project description will be pre-filled.
                </div>
                <Button className="w-full" onClick={onGenerateInvoice} disabled={pending}>
                  <Sparkles className="mr-2 h-3.5 w-3.5" />
                  {pending ? "Creating…" : "Generate invoice from this payment"}
                </Button>
              </>
            )}
          </div>
        </div>

        <SheetFooter className="mt-auto border-t border-border/60 bg-background/70 backdrop-blur">
          <Button variant="ghost" onClick={onDelete} className="mr-auto text-destructive">
            <Trash2 className="mr-1.5 h-4 w-4" />
            Delete
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate font-medium">{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
